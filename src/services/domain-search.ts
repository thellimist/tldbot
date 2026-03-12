/**
 * Domain Search Service.
 *
 * Orchestrates domain availability checks across multiple sources:
 * 1. RDAP (free public source, no pricing)
 * 2. WHOIS (strict verification only where needed)
 *
 * Handles:
 * - Smart source selection based on availability and configuration
 * - Graceful fallback on failures
 * - Caching for performance
 * - Insights generation for vibecoding UX
 *
 */

import type {
  DomainResult,
  SearchResponse,
  VerificationMode,
} from '../types.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import {
  NoSourceAvailableError,
  wrapError,
  DomainSearchError,
  RateLimitError,
} from '../utils/errors.js';
import {
  validateDomainName,
  validateTlds,
  buildDomain,
} from '../utils/validators.js';
import { domainCache, domainCacheKey } from '../utils/cache.js';
import { ConcurrencyLimiter } from '../utils/concurrency.js';
import {
  godaddyPublicAdapter,
} from '../registrars/index.js';
import { checkRdap, isRdapAvailable } from '../fallbacks/rdap.js';
import { checkWhois, isWhoisAvailable } from '../fallbacks/whois.js';
import { fetchPricingQuote, fetchPricingCompare } from './pricing-api.js';
import { buildCheckoutUrl } from './checkout.js';
import type {
  PricingQuoteResponse,
  PricingQuote,
  PricingCompareResponse,
  PricingCompareEntry,
} from './pricing-api.js';
import {
  generatePremiumInsight,
  generatePremiumSummary,
  calculateDomainScore,
  analyzePremiumReason,
  suggestPremiumAlternatives,
} from '../utils/premium-analyzer.js';
import type { PricingStatus, PricingSource } from '../types.js';
import { lookupSedoAuction } from '../aftermarket/sedo.js';
import { lookupAftermarketByNameserver } from '../aftermarket/nameservers.js';
import {
  estimateSearchDuration,
  estimateBulkDuration,
} from '../utils/search-estimate.js';
import { CLI_COMMAND } from '../utils/cli-command.js';
import { getTldCatalogEntry } from '../utils/tld-catalog.js';
import { isHighPressureTld } from '../utils/tld-strategy.js';

const SEARCH_LOW_PRESSURE_CONCURRENCY = 8;
const SEARCH_HIGH_PRESSURE_CONCURRENCY = 3;
const BULK_CONCURRENCY = 20;
const CACHE_TTL_AVAILABLE_MS = config.cache.availabilityTtl * 1000;
const CACHE_TTL_TAKEN_MS = config.cache.availabilityTtl * 2000;
const DEFAULT_PRICING_BUDGET = 0;
const BULK_PRICING_BUDGET = 0;

type PricingOptions = {
  enabled: boolean;
  maxQuotes: number;
};

type PricingBudget = {
  enabled: boolean;
  take: () => boolean;
};

type SearchOptions = {
  pricing?: PricingOptions;
};

function formatRetryTime(timestampMs: number): string {
  return new Date(timestampMs).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatDomainCheckError(
  tld: string,
  error: DomainSearchError,
): string {
  if (error instanceof RateLimitError && error.retryAfter) {
    const waitSeconds = Math.max(1, Math.ceil((error.retryAfter - Date.now()) / 1000));
    return `${tld}: rate limited, retry in ${waitSeconds}s at ${formatRetryTime(error.retryAfter)}`;
  }

  return `${tld}: ${error.userMessage}`;
}


function createPricingBudget(options?: PricingOptions): PricingBudget {
  const enabled = options?.enabled ?? config.pricingApi.enabled;
  const maxQuotes = options?.maxQuotes ?? DEFAULT_PRICING_BUDGET;
  const unlimited = enabled && maxQuotes <= 0;
  let remaining = enabled ? Math.max(0, maxQuotes) : 0;
  return {
    enabled,
    take: () => {
      if (!enabled) return false;
      if (unlimited) return true;
      if (remaining <= 0) return false;
      remaining -= 1;
      return true;
    },
  };
}

function buildRegistrarPriceUrl(
  registrar: string | undefined,
  domain: string,
): string | null {
  const normalized = registrar ? registrar.toLowerCase() : 'unknown';
  switch (normalized) {
    case 'namecheap':
      return `https://www.namecheap.com/domains/registration/results/?domain=${encodeURIComponent(domain)}`;
    case 'godaddy':
    case 'unknown':
      return `https://www.godaddy.com/domainsearch/find?domainToCheck=${encodeURIComponent(domain)}`;
    default:
      return `https://www.godaddy.com/domainsearch/find?domainToCheck=${encodeURIComponent(domain)}`;
  }
}

function buildAftermarketUrl(domain: string): string {
  return `https://auctions.godaddy.com/trpSearchResults.aspx?domain=${encodeURIComponent(domain)}`;
}

async function applyAftermarketFallback(result: DomainResult): Promise<void> {
  if (result.available || result.aftermarket) {
    return;
  }

  if (result.source === 'godaddy_api') {
    const reason = (result.premium_reason || '').toLowerCase();
    if (reason.includes('auction') || reason.includes('premium')) {
      result.aftermarket = {
        type: reason.includes('auction') ? 'auction' : 'premium',
        price: null,
        currency: null,
        source: 'godaddy',
        marketplace: 'GoDaddy',
        url: buildAftermarketUrl(result.domain),
        note: 'GoDaddy public data indicates an auction or premium resale listing.',
      };
      return;
    }
  }

  // Run Sedo and NS lookups in parallel for better performance
  const [sedoListing, nsListing] = await Promise.all([
    lookupSedoAuction(result.domain),
    lookupAftermarketByNameserver(result.domain),
  ]);

  // Prefer Sedo (has pricing), then NS-based hints
  if (sedoListing) {
    result.aftermarket = {
      type: 'auction',
      price: sedoListing.price,
      currency: sedoListing.currency,
      source: sedoListing.source,
      marketplace: 'Sedo',
      url: sedoListing.url,
      note: 'Listed in Sedo auctions feed. Verify details at the marketplace link.',
    };
    return;
  }

  if (nsListing) {
    result.aftermarket = nsListing;
  }
}

function finalizeDomainResult(result: DomainResult): void {
  if (result.available) {
    result.status = 'available';
    result.marketplace = undefined;

    if (config.checkout.enabled && !result.checkout_url) {
      const purchaseLink = buildCheckoutUrl(result.domain, result.registrar);
      result.checkout_url = purchaseLink.checkout_url;
    }

    return;
  }

  if (result.aftermarket) {
    result.status = 'for_sale';
    result.marketplace =
      result.aftermarket.marketplace ||
      result.marketplace ||
      result.aftermarket.source;
    if (result.aftermarket.price !== null && result.price_first_year === null) {
      result.price_first_year = result.aftermarket.price;
      if (result.aftermarket.currency) {
        result.currency = result.aftermarket.currency;
      }
      result.price_note = 'Confident listing price from marketplace page.';
    }
    return;
  }

  result.status = 'taken';
  result.marketplace = undefined;
  result.checkout_url = undefined;
}

function applyPublicPriceEstimate(result: DomainResult): void {
  if (!result.available || result.price_first_year !== null) {
    return;
  }

  const tld = result.domain.split('.').pop() || '';
  const catalog = getTldCatalogEntry(tld);
  const estimatedFirstYear = Math.round(
    ((catalog.price_range.min + catalog.price_range.max) / 2) * 100,
  ) / 100;

  result.price_first_year = estimatedFirstYear;
  result.price_renewal = catalog.renewal_price_typical;
  result.currency = catalog.price_range.currency;
  result.pricing_status = 'catalog_only';
  result.pricing_source = 'catalog';
  result.price_note = 'Estimated from public TLD catalog data. Verify at checkout.';
}

function applyPricingMetadata(result: DomainResult): void {
  if (!result.price_check_url) {
    if (
      config.pricingApi.enabled &&
      (!result.registrar || result.registrar === 'unknown')
    ) {
      result.price_check_url =
        buildRegistrarPriceUrl('namecheap', result.domain) || undefined;
    } else {
      result.price_check_url =
        buildRegistrarPriceUrl(result.registrar, result.domain) || undefined;
    }
  }

  if (result.price_note) {
    return;
  }

  if (result.pricing_status === 'catalog_only') {
    result.price_note = 'Estimated price from catalog. Verify via price_check_url.';
    return;
  }

  if (result.pricing_status === 'not_available') {
    result.price_note =
      'Live price unavailable (rate-limited or not configured). Verify via price_check_url.';
    return;
  }

  if (result.pricing_status === 'not_configured') {
    result.price_note = 'Pricing backend not configured. Verify via price_check_url.';
    return;
  }

  if (result.pricing_status === 'error') {
    result.price_note = 'Price check failed. Verify via price_check_url.';
    return;
  }

  if (result.pricing_status === 'partial') {
    result.price_note = 'Partial price data. Verify via price_check_url.';
    return;
  }

  if (result.pricing_status === 'ok') {
    result.price_note = 'Live price quote. Verify via price_check_url.';
    return;
  }

  result.price_note = 'Verify pricing via price_check_url.';
}

/**
 * Search for domain availability across multiple TLDs.
 * Uses Porkbun as primary source when configured, with RDAP/WHOIS fallback.
 */
export async function searchDomain(
  domainName: string,
  tlds: string[] = config.defaultSearchTlds,
  preferredRegistrars?: string[],
  verificationMode: VerificationMode = 'smart',
  options?: SearchOptions,
): Promise<SearchResponse> {
  const startTime = Date.now();
  const normalizedDomain = validateDomainName(domainName);
  const normalizedTlds = validateTlds(tlds);
  const pricingBudget = createPricingBudget(options?.pricing);
  const estimate = estimateSearchDuration(
    normalizedTlds,
    pricingBudget.enabled,
    SEARCH_LOW_PRESSURE_CONCURRENCY + SEARCH_HIGH_PRESSURE_CONCURRENCY,
  );

  logger.info(`Searching ${normalizedDomain} ${normalizedTlds.join(',')}`);

  // Search each TLD
  const results: DomainResult[] = [];
  const errors: string[] = [];
  const nonVerifiedDomains = new Set<string>();
  let fromCache = false;

  // Run TLD checks with concurrency limits
  const lowPressureLimiter = new ConcurrencyLimiter(SEARCH_LOW_PRESSURE_CONCURRENCY);
  const highPressureLimiter = new ConcurrencyLimiter(SEARCH_HIGH_PRESSURE_CONCURRENCY);
  const outcomes = await Promise.all(
    normalizedTlds.map((tld) =>
      (isHighPressureTld(tld) ? highPressureLimiter : lowPressureLimiter).run(async () => {
        try {
          const result = await searchSingleDomain(
            normalizedDomain,
            tld,
            preferredRegistrars,
            pricingBudget,
            verificationMode,
          );
          if (result.fromCache) fromCache = true;
          if (result.result.verification && result.result.verification !== 'confirmed') {
            nonVerifiedDomains.add(result.result.domain);
          }
          return { success: true as const, tld, result: result.result };
        } catch (error) {
          const wrapped = wrapError(error);
          if (wrapped instanceof RateLimitError && wrapped.retryAfter) {
            const waitSeconds = Math.max(1, Math.ceil((wrapped.retryAfter - Date.now()) / 1000));
            logger.warn(
              `Rate limit hit ${normalizedDomain}.${tld}. Retry in ${waitSeconds}s at ${formatRetryTime(wrapped.retryAfter)}`,
            );
          }
          if (
            isHighPressureTld(tld) &&
            ['RATE_LIMIT', 'TIMEOUT', 'NO_SOURCE_AVAILABLE', 'REGISTRAR_API_ERROR'].includes(
              wrapped.code,
            )
          ) {
            nonVerifiedDomains.add(`${normalizedDomain}.${tld}`);
          }
          return { success: false as const, tld, error: wrapped };
        }
      }),
    ),
  );

  for (const outcome of outcomes) {
    if (outcome.success) {
      results.push(outcome.result);
    } else {
      errors.push(formatDomainCheckError(outcome.tld, outcome.error));
      logger.warn(`Failed ${normalizedDomain}.${outcome.tld}`);
    }
  }

  // Generate insights and next steps
  const insights = generateInsights(results, errors, [...nonVerifiedDomains]);
  const nextSteps = generateNextSteps(
    results,
    [...nonVerifiedDomains],
    normalizedDomain,
  );

  const duration = Date.now() - startTime;
  logger.info(`Completed ${normalizedDomain}`);

  return {
    results,
    estimate,
    insights,
    next_steps: nextSteps,
    non_verified_domains: [...nonVerifiedDomains],
    from_cache: fromCache,
    duration_ms: duration,
  };
}

/**
 * Search a single domain with fallback chain.
 * Priority: Porkbun (with pricing) → Namecheap → RDAP → WHOIS
 */
async function searchSingleDomain(
  domain: string,
  tld: string,
  preferredRegistrars?: string[],
  pricingBudget?: PricingBudget,
  verificationMode: VerificationMode = 'smart',
): Promise<{ result: DomainResult; fromCache: boolean }> {
  const fullDomain = buildDomain(domain, tld);
  const triedSources: string[] = [];

  // Check cache first
  for (const source of [
    'godaddy_api',
    'pricing_api',
    'rdap',
    'whois',
  ] as const) {
    const cacheKey = domainCacheKey(fullDomain, source);
    const cached = domainCache.get(cacheKey);
    if (cached) {
      logger.debug('Cache hit', { domain: fullDomain, source });
      return { result: cached, fromCache: true };
    }
  }

  // Build source priority
  const sources = buildSourcePriority(tld, preferredRegistrars, verificationMode);

  // Try each source
  for (const source of sources) {
    triedSources.push(source);

    try {
      const result = await trySource(domain, tld, source, verificationMode);
      if (result) {
        await applyPricingQuote(result, pricingBudget);
        // Calculate quality score
        result.score = calculateDomainScore(result);

        // Enhance premium_reason with analysis
        if (result.premium && !result.premium_reason) {
          const reasons = analyzePremiumReason(result.domain);
          result.premium_reason = reasons.length > 0
            ? reasons.join(', ')
            : 'Premium domain';
        }

        // Cache the result
        const cacheKey = domainCacheKey(fullDomain, result.source);
        const ttlMs = result.available ? CACHE_TTL_AVAILABLE_MS : CACHE_TTL_TAKEN_MS;
        domainCache.set(cacheKey, result, ttlMs);

        return { result, fromCache: false };
      }
    } catch (error) {
      const wrapped = wrapError(error);
      logger.debug(`Source ${source} failed, trying next`, {
        domain: fullDomain,
        error: wrapped.message,
        retryable: wrapped.retryable,
      });

      if (!wrapped.retryable) {
        continue;
      }
    }
  }

  // All sources failed
  throw new NoSourceAvailableError(fullDomain, triedSources);
}

/**
 * Build the priority list of sources to try.
 *
 * Priority order:
 * 1. RDAP (free, no pricing, fast)
 * 2. WHOIS (verification only; slower and more rate-limit sensitive)
 */
function buildSourcePriority(
  tld: string,
  _preferredRegistrars?: string[],
  verificationMode: VerificationMode = 'smart',
): string[] {
  const sources: string[] = [];

  // Always add fallbacks in order: RDAP → optional WHOIS
  if (isRdapAvailable(tld)) sources.push('rdap');

  if (
    isWhoisAvailable(tld) &&
    (verificationMode === 'strict' ||
      (verificationMode === 'smart' && !isHighPressureTld(tld)))
  ) {
    sources.push('whois');
  }

  return sources;
}

/**
 * Try a specific source for domain lookup.
 */
async function trySource(
  domain: string,
  tld: string,
  source: string,
  verificationMode: VerificationMode = 'smart',
): Promise<DomainResult | null> {
  switch (source) {
    case 'godaddy':
      return godaddyPublicAdapter.search(domain, tld);

    case 'rdap':
      return checkRdap(domain, tld, { verificationMode });

    case 'whois':
      return checkWhois(domain, tld);

    default:
      logger.warn(`Unknown source: ${source}`);
      return null;
  }
}

function pickBestQuote(
  quotes: PricingQuote[],
  best: { registrar: string } | null,
): PricingQuote | null {
  if (best) {
    const matched = quotes.find((q) => q.registrar === best.registrar);
    if (matched) return matched;
  }

  return (
    quotes.find((q) => q.price_first_year !== null) ||
    quotes.find((q) => q.price_renewal !== null) ||
    quotes[0] ||
    null
  );
}

function compareEntryToResult(entry: PricingCompareEntry): DomainResult {
  const result: DomainResult = {
    domain: entry.domain,
    available: entry.available ?? true,
    status: entry.available === false ? 'taken' : 'available',
    premium: entry.premium ?? false,
    price_first_year: entry.price_first_year,
    price_renewal: entry.price_renewal,
    currency: entry.currency ?? 'USD',
    privacy_included: false,
    transfer_price: entry.price_transfer,
    registrar: entry.registrar,
    source: entry.source === 'catalog' ? 'catalog' : 'pricing_api',
    pricing_source: entry.source === 'catalog' ? 'catalog' : 'pricing_api',
    pricing_status: entry.quote_status,
    checked_at: new Date().toISOString(),
    premium_reason: entry.premium ? 'Premium domain' : undefined,
  };

  if (result.premium && result.price_first_year !== null) {
    result.aftermarket = {
      type: 'premium',
      price: result.price_first_year,
      currency: result.currency ?? null,
      source: entry.source === 'catalog' ? 'catalog' : 'pricing_api',
      marketplace: result.registrar,
      url: buildRegistrarPriceUrl(result.registrar, result.domain) || undefined,
      note: 'Premium pricing detected. Verify at registrar checkout.',
    };
  }

  applyPricingMetadata(result);
  finalizeDomainResult(result);
  return result;
}

function mergePricing(
  result: DomainResult,
  payload: PricingQuoteResponse,
): void {
  result.pricing_status = payload.quote_status as PricingStatus;
  result.pricing_source =
    payload.quote_status === 'catalog_only' ? 'catalog' : 'pricing_api';

  const quotes = payload.quotes || [];

  // CRITICAL: Check if backend (Porkbun) says domain is actually NOT available.
  // This corrects RDAP false positives where RDAP says available but Porkbun says taken.
  const backendSaysNotAvailable = quotes.some((q) => q.available === false);
  if (backendSaysNotAvailable) {
    logger.debug('Backend corrected RDAP false positive', {
      domain: result.domain,
      rdap_said: result.available,
      backend_says: false,
    });
    result.available = false;
    result.source = 'pricing_api'; // Backend provided the authoritative answer
    result.price_first_year = null;
    result.price_renewal = null;
    result.transfer_price = null;
    result.pricing_status = 'not_available';
    applyPricingMetadata(result);
    finalizeDomainResult(result);
    return;
  }

  const bestFirst = payload.best_first_year;
  const selected = pickBestQuote(quotes, bestFirst);

  if (bestFirst) {
    result.price_first_year = bestFirst.price;
    result.registrar = bestFirst.registrar;
    if (bestFirst.currency) {
      result.currency = bestFirst.currency;
    }
  } else if (selected && selected.price_first_year !== null) {
    result.price_first_year = selected.price_first_year;
    result.registrar = selected.registrar;
    if (selected.currency) {
      result.currency = selected.currency;
    }
  }

  if (selected) {
    result.price_renewal = selected.price_renewal ?? result.price_renewal;
    result.transfer_price = selected.price_transfer ?? result.transfer_price;
    if (!result.registrar) {
      result.registrar = selected.registrar;
    }
  }

  const hasPremium = quotes.some((q) => q.premium === true);
  if (hasPremium) {
    result.premium = true;
    if (!result.premium_reason) {
      result.premium_reason = 'Premium domain';
    }
    if (!result.aftermarket) {
      result.aftermarket = {
        type: 'premium',
        price: result.price_first_year,
        currency: result.currency ?? null,
        source: 'pricing_api',
        marketplace: result.registrar,
        url: buildRegistrarPriceUrl(result.registrar, result.domain) || undefined,
        note: 'Premium pricing detected. Verify at registrar checkout.',
      };
    }
  }

  const hasAnyPrice =
    result.price_first_year !== null ||
    result.price_renewal !== null ||
    result.transfer_price !== null;
  if (!hasAnyPrice && result.pricing_status === 'ok') {
    result.pricing_status = 'partial';
  }

  applyPricingMetadata(result);
  finalizeDomainResult(result);
}

async function applyPricingQuote(
  result: DomainResult,
  pricingBudget?: PricingBudget,
): Promise<void> {
  if (!pricingBudget?.enabled) {
    applyPublicPriceEstimate(result);
    if (!result.pricing_status) {
      result.pricing_status = 'not_configured';
    }
    applyPricingMetadata(result);
    await applyAftermarketFallback(result);
    finalizeDomainResult(result);
    return;
  }

  if (!result.available) {
    result.pricing_status = 'not_available';
    applyPricingMetadata(result);
    await applyAftermarketFallback(result);
    finalizeDomainResult(result);
    return;
  }

  if (!pricingBudget.take()) {
    applyPublicPriceEstimate(result);
    if (!result.pricing_status) {
      result.pricing_status = 'not_available';
    }
    applyPricingMetadata(result);
    await applyAftermarketFallback(result);
    finalizeDomainResult(result);
    return;
  }

  const payload = await fetchPricingQuote(result.domain);
  if (!payload) {
    applyPublicPriceEstimate(result);
    if (!result.pricing_status) {
      result.pricing_status = 'error';
    }
    applyPricingMetadata(result);
    await applyAftermarketFallback(result);
    finalizeDomainResult(result);
    return;
  }

  mergePricing(result, payload);
  await applyAftermarketFallback(result);
  finalizeDomainResult(result);
}

/**
 * Generate human-readable insights about the results.
 */
function generateInsights(
  results: DomainResult[],
  errors: string[],
  nonVerifiedDomains: string[] = [],
): string[] {
  const insights: string[] = [];

  // Available domains summary
  const available = results.filter((r) => r.status === 'available');
  const forSale = results.filter((r) => r.status === 'for_sale');
  const taken = results.filter((r) => r.status === 'taken');

  if (available.length > 0) {
    const cheapest = available.reduce(
      (min, r) =>
        r.price_first_year !== null &&
        (min === null || r.price_first_year < min.price_first_year!)
          ? r
          : min,
      null as DomainResult | null,
    );

    if (cheapest && cheapest.price_first_year !== null) {
      insights.push(
        `✅ ${available.length} domain${available.length > 1 ? 's' : ''} available! Best price: ${cheapest.domain} at $${cheapest.price_first_year}/year (${cheapest.registrar})`,
      );
    } else {
      insights.push(
        `✅ ${available.length} domain${available.length > 1 ? 's' : ''} available!`,
      );
    }
  }

  if (taken.length > 0) {
    insights.push(
      `❌ ${taken.length} domain${taken.length > 1 ? 's' : ''} already taken`,
    );
  }

  if (forSale.length > 0) {
    insights.push(
      `💰 ${forSale.length} domain${forSale.length > 1 ? 's are' : ' is'} listed for resale`,
    );
  }

  // TLD-specific advice
  for (const result of results) {
    if (result.status === 'available') {
      const tld = result.domain.split('.').pop()!;
      const advice = getTldAdvice(tld, result);
      if (advice) {
        insights.push(advice);
      }
    }
  }

  // Premium insights (enhanced with analyzer)
  const premiums = results.filter((r) => r.premium && r.status === 'available');
  if (premiums.length > 0) {
    // Add detailed insight for each premium domain
    for (const premium of premiums) {
      const premiumInsight = generatePremiumInsight(premium);
      if (premiumInsight) {
        insights.push(premiumInsight);
      }
    }

    // Add summary insights (alternatives, pricing context)
    const summaryInsights = generatePremiumSummary(results);
    insights.push(...summaryInsights);
  }

  // Privacy insight
  const withPrivacy = results.filter(
    (r) => r.status === 'available' && r.privacy_included,
  );
  if (withPrivacy.length > 0) {
    insights.push(
      `🔒 ${withPrivacy.length} option${withPrivacy.length > 1 ? 's' : ''} include free WHOIS privacy`,
    );
  }

  // Expiration insights for taken domains
  const takenWithExpiration = results.filter(
    (r) => r.status !== 'available' && r.expires_at && r.days_until_expiration !== undefined,
  );

  for (const domain of takenWithExpiration) {
    if (domain.days_until_expiration !== undefined) {
      if (domain.days_until_expiration <= 0) {
        insights.push(
          `🕐 ${domain.domain} has EXPIRED — may become available soon!`,
        );
      } else if (domain.days_until_expiration <= 30) {
        insights.push(
          `🕐 ${domain.domain} expires in ${domain.days_until_expiration} days — watch for availability`,
        );
      } else if (domain.days_until_expiration <= 90) {
        insights.push(
          `📅 ${domain.domain} expires in ${Math.round(domain.days_until_expiration / 30)} months`,
        );
      }
    }
  }

  // Error summary
  if (errors.length > 0) {
    insights.push(`⚠️ Could not check some TLDs: ${errors.join(', ')}`);
  }

  if (nonVerifiedDomains.length > 0) {
    insights.push(
      `⚠️ Non-verified: ${nonVerifiedDomains.join(', ')}. Run a verify pass before acting on those.`,
    );
  }

  return insights;
}

/**
 * Get TLD-specific advice.
 */
function getTldAdvice(tld: string, result: DomainResult): string | null {
  const advice: Record<string, string> = {
    com: '💡 .com is the classic, universal choice — trusted worldwide',
    io: '💡 .io is popular with tech startups and SaaS products',
    dev: '💡 .dev signals developer/tech credibility (requires HTTPS)',
    app: '💡 .app is perfect for mobile/web applications (requires HTTPS)',
    co: '💡 .co is a popular alternative to .com for companies',
    ai: '💡 .ai is trending for AI/ML projects',
    sh: '💡 .sh is popular with developers (shell scripts!)',
    bot: '💡 .bot is strong for agents, automation, and chatbot products',
  };

  return advice[tld] || null;
}

/**
 * Generate suggested next steps.
 */
function generateNextSteps(
  results: DomainResult[],
  nonVerifiedDomains: string[] = [],
  baseNameOverride?: string,
): string[] {
  const nextSteps: string[] = [];
  const available = results.filter((r) => r.status === 'available');
  const forSale = results.filter((r) => r.status === 'for_sale');
  const taken = results.filter((r) => r.status === 'taken');
  const premiumAvailable = available.filter((r) => r.premium);
  const nonPremiumAvailable = available.filter((r) => !r.premium);

  if (available.length > 0) {
    // Check other TLDs
    const baseName = baseNameOverride || available[0]!.domain.split('.')[0]!;
    const checkedTlds = new Set(results.map((r) => r.domain.split('.').pop()));
    const suggestedTlds = ['com', 'io', 'dev', 'app', 'co', 'ai'].filter(
      (t) => !checkedTlds.has(t),
    );
    if (suggestedTlds.length > 0) {
      nextSteps.push(
        `${CLI_COMMAND} search ${baseName} --tlds ${suggestedTlds.slice(0, 3).join(',')}`,
      );
    }

    // Premium-specific advice
    if (premiumAvailable.length > 0 && nonPremiumAvailable.length === 0) {
      // All available domains are premium
      const firstPremium = premiumAvailable[0]!;
      const alternatives = suggestPremiumAlternatives(firstPremium.domain);
      if (alternatives.length > 0) {
        nextSteps.push(
          `${CLI_COMMAND} search ${alternatives[0]} --tlds ${available[0]!.domain.split('.').pop()!}`,
        );
      }
    }

    // Check social handles
    nextSteps.push(`${CLI_COMMAND} check_socials ${baseName}`);
  }

  if (taken.length > 0 && available.length === 0) {
    const baseName = baseNameOverride || taken[0]!.domain.split('.')[0]!;
    nextSteps.push(`${CLI_COMMAND} search ${baseName} --tlds app,net,org`);
  }

  if (forSale.length > 0 && available.length === 0) {
    const listing = forSale[0]!;
    nextSteps.push(`${CLI_COMMAND} buy ${listing.domain}`);
    nextSteps.push(`${CLI_COMMAND} buy ${listing.domain} --price`);
  }

  if (available.length > 0) {
    // Prefer non-premium for registration suggestion
    const best = nonPremiumAvailable.length > 0
      ? nonPremiumAvailable.reduce((a, b) =>
          (a.price_first_year || Infinity) < (b.price_first_year || Infinity) ? a : b
        )
      : available[0]!;

    nextSteps.push(`${CLI_COMMAND} buy ${best.domain} --price`);
    nextSteps.push(`${CLI_COMMAND} buy ${best.domain} --registrar namecheap`);
    nextSteps.push(`${CLI_COMMAND} buy ${best.domain} --registrar godaddy`);
    nextSteps.push(`${CLI_COMMAND} buy ${best.domain} --registrar cloudflare`);
  }

  if (nonVerifiedDomains.length > 0) {
    const baseName = baseNameOverride || results[0]?.domain.split('.')[0];
    const verifyTlds = [...new Set(
      nonVerifiedDomains
        .map((domain) => domain.split('.').pop())
        .filter((tld): tld is string => Boolean(tld)),
    )];
    if (baseName && verifyTlds.length > 0) {
      nextSteps.push(
        `${CLI_COMMAND} search ${baseName} --tlds ${verifyTlds.join(',')} --verify`,
      );
    }
  }

  return [...new Set(nextSteps)];
}

function getDefaultComparisonRegistrars(): string[] {
  return [];
}

async function detectDomainMarketState(
  domain: string,
  tld: string,
): Promise<DomainResult | null> {
  try {
    const snapshot = await searchSingleDomain(
      domain,
      tld,
      undefined,
      createPricingBudget({ enabled: false, maxQuotes: 0 }),
      'strict',
    );
    return snapshot.result;
  } catch {
    return null;
  }
}

/**
 * Bulk search for multiple domains.
 */
export async function bulkSearchDomains(
  domains: string[],
  tld: string = 'com',
  registrar?: string,
  maxConcurrent: number = BULK_CONCURRENCY,
): Promise<DomainResult[]> {
  const startTime = Date.now();
  const results: DomainResult[] = [];
  const pricingBudget = createPricingBudget({
    enabled: config.pricingApi.enabled,
    maxQuotes: BULK_PRICING_BUDGET,
  });
  const estimate = estimateBulkDuration(
    domains.length,
    tld,
    maxConcurrent,
    pricingBudget.enabled,
  );

  logger.info('Bulk search started', {
    count: domains.length,
    tld,
    registrar,
    estimated_duration_ms: estimate.estimated_duration_ms,
    estimated_duration: estimate.estimated_duration_label,
  });

  // Process in batches
  for (let i = 0; i < domains.length; i += maxConcurrent) {
    const batch = domains.slice(i, i + maxConcurrent);
    const batchPromises = batch.map(async (domain) => {
      try {
        const normalizedDomain = validateDomainName(domain);
        const { result } = await searchSingleDomain(
          normalizedDomain,
          tld,
          registrar ? [registrar] : undefined,
          pricingBudget,
          'smart',
        );
        return result;
      } catch (error) {
        logger.warn(`Failed to check ${domain}.${tld}`, {
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    });

    const batchResults = await Promise.all(batchPromises);
    for (const result of batchResults) {
      if (result) results.push(result);
    }

  }

  const duration = Date.now() - startTime;
  logger.info('Bulk search completed', {
    checked: domains.length,
    results: results.length,
    duration_ms: duration,
  });

  return results;
}

/**
 * Compare pricing across registrars.
 */
export async function compareRegistrars(
  domain: string,
  tld: string,
  registrars?: string[],
  verificationMode: VerificationMode = 'strict',
): Promise<{
  comparisons: DomainResult[];
  best_first_year: { registrar: string; price: number } | null;
  best_renewal: { registrar: string; price: number } | null;
  recommendation: string;
}> {
  const normalizedDomain = validateDomainName(domain);
  const comparisons: DomainResult[] = [];
  const normalizedRegistrars = (registrars && registrars.length > 0
    ? registrars
    : getDefaultComparisonRegistrars()).map((r) => r.toLowerCase());

  if (config.pricingApi.enabled) {
    const response = await fetchPricingCompare(
      normalizedDomain,
      tld,
      normalizedRegistrars.length > 0 ? normalizedRegistrars : undefined,
    );

    if (response) {
      for (const entry of response.comparisons) {
        comparisons.push(compareEntryToResult(entry));
      }

      const bestFirst = response.best_first_year
        ? {
            registrar: response.best_first_year.registrar,
            price: response.best_first_year.price,
          }
        : null;
      const bestRenewal = response.best_renewal
        ? {
            registrar: response.best_renewal.registrar,
            price: response.best_renewal.price,
          }
        : null;

      let recommendation = 'Pricing comparison unavailable. Verify live checkout pricing.';
      if (bestFirst && bestRenewal) {
        if (bestFirst.registrar === bestRenewal.registrar) {
          recommendation = `${bestFirst.registrar} offers the best price for both first year ($${bestFirst.price}) and renewal ($${bestRenewal.price})`;
        } else {
          recommendation = `${bestFirst.registrar} for first year ($${bestFirst.price}), ${bestRenewal.registrar} for renewal ($${bestRenewal.price})`;
        }
      } else if (bestFirst) {
        recommendation = `${bestFirst.registrar} has the best first year price: $${bestFirst.price}`;
      }

      const hasComparablePrice = comparisons.some(
        (result) => result.available && result.price_first_year !== null,
      );

      if (hasComparablePrice) {
        return {
          comparisons,
          best_first_year: bestFirst,
          best_renewal: bestRenewal,
          recommendation,
        };
      }
    }
  }

  // Fallback: local registrar adapters (BYOK)
  for (const registrar of normalizedRegistrars) {
    try {
      const { result } = await searchSingleDomain(normalizedDomain, tld, [
        registrar,
      ], undefined, verificationMode);
      comparisons.push(result);
    } catch (error) {
      logger.warn(`Registrar ${registrar} comparison failed`, {
        domain: `${normalizedDomain}.${tld}`,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const hasComparablePrice = comparisons.some(
    (result) => result.available && result.price_first_year !== null,
  );
  if (!hasComparablePrice) {
    const marketState = await detectDomainMarketState(normalizedDomain, tld);
    if (marketState?.status === 'for_sale') {
      return {
        comparisons: [marketState],
        best_first_year: null,
        best_renewal: null,
        recommendation: `Listed on ${marketState.marketplace || marketState.aftermarket?.marketplace || 'marketplace'}`,
      };
    }

    if (comparisons.length === 0 && marketState) {
      comparisons.push(marketState);
    }
  }

  if (!hasComparablePrice && comparisons.length > 0) {
    return {
      comparisons,
      best_first_year: null,
      best_renewal: null,
      recommendation: 'Pricing comparison unavailable. Use buy commands to verify live checkout pricing.',
    };
  }

  // Find best prices
  let bestFirstYear: { registrar: string; price: number } | null = null;
  let bestRenewal: { registrar: string; price: number } | null = null;

  for (const result of comparisons) {
    if (result.available && result.price_first_year !== null) {
      if (!bestFirstYear || result.price_first_year < bestFirstYear.price) {
        bestFirstYear = {
          registrar: result.registrar,
          price: result.price_first_year,
        };
      }
    }
    if (result.available && result.price_renewal !== null) {
      if (!bestRenewal || result.price_renewal < bestRenewal.price) {
        bestRenewal = {
          registrar: result.registrar,
          price: result.price_renewal,
        };
      }
    }
  }

  // Generate recommendation
  let recommendation = 'Pricing comparison unavailable. Verify live checkout pricing.';
  if (bestFirstYear && bestRenewal) {
    if (bestFirstYear.registrar === bestRenewal.registrar) {
      recommendation = `${bestFirstYear.registrar} offers the best price for both first year ($${bestFirstYear.price}) and renewal ($${bestRenewal.price})`;
    } else {
      recommendation = `${bestFirstYear.registrar} for first year ($${bestFirstYear.price}), ${bestRenewal.registrar} for renewal ($${bestRenewal.price})`;
    }
  } else if (bestFirstYear) {
    recommendation = `${bestFirstYear.registrar} has the best first year price: $${bestFirstYear.price}`;
  }

  return {
    comparisons,
    best_first_year: bestFirstYear,
    best_renewal: bestRenewal,
    recommendation,
  };
}
