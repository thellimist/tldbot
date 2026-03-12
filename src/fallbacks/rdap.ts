/**
 * RDAP (Registration Data Access Protocol) Fallback.
 *
 * RFC 7480 - Modern replacement for WHOIS.
 * Provides availability status only (no pricing).
 * Public API - no authentication required.
 */

import axios, { type AxiosError } from 'axios';
import { z } from 'zod';
import type {
  DomainResult,
  VerificationMode,
  VerificationStatus,
} from '../types.js';
import { logger } from '../utils/logger.js';
import {
  TimeoutError,
  RegistrarApiError,
  RateLimitError,
} from '../utils/errors.js';
import { TtlCache } from '../utils/cache.js';
import { KeyedLimiter } from '../utils/concurrency.js';
import { AdaptiveConcurrencyLimiter } from '../utils/adaptive-concurrency.js';
import { checkWhois } from './whois.js';
import {
  getTldPressureBucket,
  isHighPressureTld,
  shouldUseStrictVerification,
} from '../utils/tld-strategy.js';

// ═══════════════════════════════════════════════════════════════════════════
// Zod Schemas for RDAP Response Validation (RFC 7483)
// SECURITY: Validate RDAP responses to prevent unexpected data
// ═══════════════════════════════════════════════════════════════════════════

/**
 * vCard array element schema.
 * vCard format: ["property", {}, "type", value]
 */
const VCardPropertySchema = z.tuple([
  z.string(),           // property name (e.g., "fn")
  z.record(z.unknown()), // parameters (usually empty {})
  z.string(),           // type (e.g., "text")
  z.union([z.string(), z.array(z.string())]), // value
]).or(z.array(z.unknown())); // Allow flexible arrays for compatibility

/**
 * Entity schema (registrar, registrant, etc.)
 */
const RdapEntitySchema = z.object({
  roles: z.array(z.string()).optional(),
  vcardArray: z.tuple([
    z.literal('vcard'),
    z.array(VCardPropertySchema),
  ]).optional(),
}).passthrough(); // Allow additional RDAP fields

/**
 * RDAP event schema (registration, expiration, etc.)
 */
const RdapEventSchema = z.object({
  eventAction: z.string(),
  eventDate: z.string(),
}).passthrough();

/**
 * Main RDAP domain response schema.
 */
const RdapDomainResponseSchema = z.object({
  objectClassName: z.string(),
  ldhName: z.string().optional(),
  entities: z.array(RdapEntitySchema).optional(),
  events: z.array(RdapEventSchema).optional(),
}).passthrough(); // Allow additional RDAP fields

/**
 * RDAP bootstrap URLs for different TLDs.
 */
const RDAP_BOOTSTRAP = 'https://data.iana.org/rdap/dns.json';
const RDAP_BOOTSTRAP_TTL_SECONDS = 86400;

const RDAP_TIMEOUT_MS = 800;
const RDAP_ERROR_TTL_MS = 10_000;
const RDAP_GLOBAL_CONCURRENCY = 30;
const RDAP_HOST_CONCURRENCY = 2;

/**
 * TLDs where RDAP 404 responses are UNRELIABLE.
 *
 * For these TLDs, RDAP may return 404 for premium/reserved domains
 * that are actually registered. We use WHOIS as secondary verification.
 *
 * Known issues:
 * - .ai: Premium domains return 404 from RDAP but are registered
 * - .io: Some reserved domains show as 404
 * - .sh: Shares infrastructure with .ai/.io, same issue
 * - .ac: Same registry as .ai/.io/.sh
 */
const UNRELIABLE_RDAP_TLDS = new Set(['ai', 'io', 'sh', 'ac']);

/**
 * Fallback RDAP servers for common TLDs.
 * Expanded to include popular gTLDs and ccTLDs.
 */
const RDAP_SERVERS: Record<string, string> = {
  // Generic TLDs (Verisign)
  com: 'https://rdap.verisign.com/com/v1',
  net: 'https://rdap.verisign.com/net/v1',
  cc: 'https://rdap.verisign.com/cc/v1',
  tv: 'https://rdap.verisign.com/tv/v1',
  name: 'https://rdap.verisign.com/name/v1',

  // Generic TLDs (Other registries)
  org: 'https://rdap.publicinterestregistry.org/rdap/org',
  info: 'https://rdap.afilias.net/rdap/info',
  biz: 'https://rdap.nic.biz',
  xyz: 'https://rdap.nic.xyz',
  club: 'https://rdap.nic.club',
  online: 'https://rdap.nic.online',
  site: 'https://rdap.nic.site',
  tech: 'https://rdap.nic.tech',
  store: 'https://rdap.nic.store',

  // Google TLDs
  dev: 'https://rdap.nic.google/domain',
  app: 'https://rdap.nic.google/domain',
  page: 'https://rdap.nic.google/domain',
  how: 'https://rdap.nic.google/domain',
  new: 'https://rdap.nic.google/domain',
  tools: 'https://rdap.identitydigital.services/rdap',
  studio: 'https://rdap.identitydigital.services/rdap',
  company: 'https://rdap.identitydigital.services/rdap',

  // Country-code TLDs (ccTLDs)
  io: 'https://rdap.nic.io/domain',
  co: 'https://rdap.nic.co/domain',
  ai: 'https://rdap.nic.ai/domain',
  so: 'https://rdap.nic.so/domain',
  me: 'https://rdap.nic.me/domain',
  sh: 'https://rdap.nic.sh/domain',
  ac: 'https://rdap.nic.ac/domain',
  bot: 'https://rdap.nominet.uk/bot',
  gg: 'https://rdap.nic.gg/domain',
  im: 'https://rdap.nic.im/domain',

  // European ccTLDs
  eu: 'https://rdap.eurid.eu/domain',
  de: 'https://rdap.denic.de/domain',
  nl: 'https://rdap.sidn.nl',
  uk: 'https://rdap.nominet.uk/uk',
  ch: 'https://rdap.nic.ch',
  se: 'https://rdap.iis.se/domain',
  fi: 'https://rdap.traficom.fi/domain',
  cz: 'https://rdap.nic.cz',
  pl: 'https://rdap.dns.pl',

  // Other popular ccTLDs
  ca: 'https://rdap.ca.fury.ca/rdap',
  au: 'https://rdap.auda.org.au',
  nz: 'https://rdap.dnc.org.nz',
  jp: 'https://rdap.jprs.jp/rdap',
  kr: 'https://rdap.kisa.or.kr',
  in: 'https://rdap.registry.in',
  br: 'https://rdap.registro.br',

  // Specialty TLDs
  crypto: 'https://rdap.nic.crypto',
  cloud: 'https://rdap.nic.cloud',
  design: 'https://rdap.nic.design',
  agency: 'https://rdap.nic.agency',
};

/**
 * Cache for RDAP bootstrap data (IANA).
 */
const rdapBootstrapCache = new TtlCache<Record<string, string>>(
  RDAP_BOOTSTRAP_TTL_SECONDS,
  2,
);
let rdapBootstrapFallback: Record<string, string> | null = null;
const rdapErrorCache = new TtlCache<boolean>(10, 5000);
const rdapHostCooldowns = new Map<string, { until: number; strikes: number }>();
const rdapGlobalLimiter = new AdaptiveConcurrencyLimiter({
  name: 'rdap_global',
  minConcurrency: 10,
  maxConcurrency: RDAP_GLOBAL_CONCURRENCY,
  initialConcurrency: 20,
  errorThreshold: 0.15,          // 15% error rate triggers decrease
  latencyThresholdMs: 600,       // RDAP timeout is 800ms, trigger at 600
  windowMs: 30_000,              // 30 second window
  minSamples: 20,                // Need 20 samples before adjusting
  evaluationIntervalMs: 10_000,  // Evaluate every 10 seconds
});
const rdapHostLimiter = new KeyedLimiter(RDAP_HOST_CONCURRENCY);
const rdapHighPressureHostLimiter = new KeyedLimiter(1);

function getHostCooldownSeconds(bucket: string): number {
  const state = rdapHostCooldowns.get(bucket);
  if (!state) return 0;

  const remainingMs = state.until - Date.now();
  if (remainingMs <= 0) {
    rdapHostCooldowns.delete(bucket);
    return 0;
  }

  return Math.ceil(remainingMs / 1000);
}

function setHostCooldown(bucket: string, seconds: number): void {
  const existing = rdapHostCooldowns.get(bucket);
  const strikes = Math.min((existing?.strikes || 0) + 1, 4);
  const backoffSeconds = Math.min(seconds * strikes, 120);
  rdapHostCooldowns.set(bucket, {
    until: Date.now() + backoffSeconds * 1000,
    strikes,
  });
}

function clearHostCooldown(bucket: string): void {
  rdapHostCooldowns.delete(bucket);
}

/**
 * Get the RDAP server URL for a TLD.
 */
async function getRdapServer(tld: string): Promise<string | null> {
  // Check hardcoded servers first
  if (RDAP_SERVERS[tld]) {
    return RDAP_SERVERS[tld];
  }

  const cached = rdapBootstrapCache.get('bootstrap');
  if (cached) {
    return cached[tld] || null;
  }

  // Try to fetch from IANA bootstrap
  try {
    const response = await axios.get<{
      services: [string[], string[]][];
    }>(RDAP_BOOTSTRAP, { timeout: 5000 });

    const map: Record<string, string> = {};
    for (const [tlds, servers] of response.data.services) {
      for (const t of tlds) {
        map[t] = servers[0] || '';
      }
    }

    rdapBootstrapCache.set('bootstrap', map);
    rdapBootstrapFallback = map;
    return map[tld] || null;
  } catch {
    logger.debug('Failed to fetch RDAP bootstrap', { tld });
    if (rdapBootstrapFallback) {
      return rdapBootstrapFallback[tld] || null;
    }
    return null;
  }
}

/**
 * Safely extract registrar name from vCard array.
 * SECURITY: Validates array bounds and types before access.
 */
function extractRegistrarFromVCard(vcardArray: unknown): string | undefined {
  try {
    // vcardArray should be ["vcard", [...properties]]
    if (!Array.isArray(vcardArray) || vcardArray.length < 2) {
      return undefined;
    }

    const properties = vcardArray[1];
    if (!Array.isArray(properties)) {
      return undefined;
    }

    // Find the "fn" (formatted name) property
    for (const prop of properties) {
      if (!Array.isArray(prop) || prop.length < 4) {
        continue;
      }

      const [propName, , , propValue] = prop;

      if (propName === 'fn' && typeof propValue === 'string') {
        return propValue;
      }
    }

    return undefined;
  } catch (error) {
    logger.debug('Failed to extract registrar from vCard', {
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

/**
 * Parsed RDAP data including availability and registration info.
 */
interface RdapParsedData {
  available: boolean;
  registrar?: string;
  registeredAt?: string;
  expiresAt?: string;
}

/**
 * Parse RDAP response to determine availability and extract dates.
 * SECURITY: Validates response with Zod schema before processing.
 */
function parseRdapResponse(data: unknown): RdapParsedData {
  if (!data || typeof data !== 'object') {
    return { available: false };
  }

  // Validate with Zod schema
  const parseResult = RdapDomainResponseSchema.safeParse(data);
  if (!parseResult.success) {
    logger.debug('RDAP response validation failed', {
      errors: parseResult.error.errors.slice(0, 3), // Limit logged errors
    });
    // Still try to extract basic info even if validation fails
    const record = data as Record<string, unknown>;
    if (record.objectClassName === 'domain') {
      return { available: false };
    }
    return { available: false };
  }

  const validated = parseResult.data;

  // If we got a domain record, it's registered (not available)
  if (validated.objectClassName === 'domain') {
    let registrar: string | undefined;
    let registeredAt: string | undefined;
    let expiresAt: string | undefined;

    // Safely extract registrar info
    if (validated.entities) {
      for (const entity of validated.entities) {
        if (entity.roles?.includes('registrar') && entity.vcardArray) {
          registrar = extractRegistrarFromVCard(entity.vcardArray);
          if (registrar) break;
        }
      }
    }

    // Extract event dates (registration, expiration, last changed)
    if (validated.events) {
      for (const event of validated.events) {
        const action = event.eventAction.toLowerCase();
        if (action === 'registration' || action === 'created') {
          registeredAt = event.eventDate;
        } else if (action === 'expiration') {
          expiresAt = event.eventDate;
        }
      }
    }

    return { available: false, registrar, registeredAt, expiresAt };
  }

  return { available: false };
}

/**
 * Check domain availability using RDAP.
 */
export async function checkRdap(
  domain: string,
  tld: string,
  options: { verificationMode?: VerificationMode } = {},
): Promise<DomainResult> {
  const fullDomain = `${domain}.${tld}`;
  logger.debug('RDAP check', { domain: fullDomain });
  const verificationMode = options.verificationMode || 'smart';

  const errorKey = `rdap:${fullDomain.toLowerCase()}`;
  if (rdapErrorCache.has(errorKey)) {
    throw new RegistrarApiError('rdap', 'Recent RDAP failure, backing off');
  }

  const server = await getRdapServer(tld);
  if (!server) {
    throw new RegistrarApiError('rdap', `No RDAP server found for .${tld}`);
  }

  const url = `${server}/domain/${fullDomain}`;
  let serverHost = server;
  try {
    serverHost = new URL(server).hostname;
  } catch {
    // Leave serverHost as-is if URL parsing fails.
  }
  const hostBucket = getTldPressureBucket(tld, serverHost);
  const cooldownSeconds = getHostCooldownSeconds(hostBucket);
  if (cooldownSeconds > 0) {
    throw new RateLimitError(`RDAP ${hostBucket}`, cooldownSeconds);
  }

  try {
    const hostLimiter = isHighPressureTld(tld)
      ? rdapHighPressureHostLimiter
      : rdapHostLimiter;
    const response = await rdapGlobalLimiter.run(() =>
      hostLimiter.run(hostBucket, () =>
        axios.get(url, {
          timeout: RDAP_TIMEOUT_MS,
          headers: {
            Accept: 'application/rdap+json',
          },
          // Don't throw on 404 - that means available
          validateStatus: (status) => status < 500,
        }),
      ),
    );
    clearHostCooldown(hostBucket);

    // 404 = domain not found = potentially available
    if (response.status === 404) {
      // For unreliable TLDs (e.g., .ai), verify with WHOIS before confirming
      // RDAP returns 404 for premium/reserved domains that are actually registered
      if (
        UNRELIABLE_RDAP_TLDS.has(tld) &&
        shouldUseStrictVerification(tld, verificationMode)
      ) {
        logger.debug('RDAP 404 for unreliable TLD, verifying with WHOIS', {
          domain: fullDomain,
          tld,
        });
        try {
          const whoisResult = await checkWhois(domain, tld);
          if (!whoisResult.available) {
            logger.debug('RDAP false positive detected - WHOIS says registered', {
              domain: fullDomain,
            });
            return whoisResult; // Domain is actually taken
          }
          // Both RDAP and WHOIS agree - domain is available
          logger.debug('WHOIS confirmed availability', { domain: fullDomain });
        } catch (error) {
          // WHOIS failed - default to NOT available (fail-safe)
          logger.warn('WHOIS verification failed for unreliable TLD, assuming not available', {
            domain: fullDomain,
            error: error instanceof Error ? error.message : String(error),
          });
          return createRdapResult(domain, tld, false, {
            verification: 'skipped_rate_limited',
            verificationNote: 'WHOIS verification failed after RDAP 404.',
          });
        }
      }
      const verification = UNRELIABLE_RDAP_TLDS.has(tld)
        ? shouldUseStrictVerification(tld, verificationMode)
          ? 'confirmed'
          : 'provisional'
        : 'confirmed';
      return createRdapResult(domain, tld, true, {
        verification,
        verificationNote:
          verification === 'provisional'
            ? 'RDAP said available; deep WHOIS verification was skipped for this high-pressure TLD.'
            : undefined,
      });
    }

    // 200 = domain found = not available
    if (response.status === 200) {
      const parsed = parseRdapResponse(response.data);
      return createRdapResult(domain, tld, parsed.available, {
        registeredAt: parsed.registeredAt,
        expiresAt: parsed.expiresAt,
        verification: 'confirmed',
      });
    }

    throw new RegistrarApiError(
      'rdap',
      `Unexpected response: HTTP ${response.status}`,
    );
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;

      if (axiosError.code === 'ECONNABORTED') {
        rdapErrorCache.set(errorKey, true, RDAP_ERROR_TTL_MS);
        setHostCooldown(hostBucket, 20);
        throw new TimeoutError('RDAP lookup', RDAP_TIMEOUT_MS);
      }

      // 404 = potentially available (same logic as above)
      if (axiosError.response?.status === 404) {
        if (
          UNRELIABLE_RDAP_TLDS.has(tld) &&
          shouldUseStrictVerification(tld, verificationMode)
        ) {
          try {
            const whoisResult = await checkWhois(domain, tld);
            if (!whoisResult.available) {
              return whoisResult; // Domain is actually taken
            }
          } catch {
            // WHOIS failed - default to NOT available (fail-safe)
            return createRdapResult(domain, tld, false, {
              verification: 'skipped_rate_limited',
              verificationNote: 'WHOIS verification failed after RDAP 404.',
            });
          }
        }
        const verification = UNRELIABLE_RDAP_TLDS.has(tld)
          ? shouldUseStrictVerification(tld, verificationMode)
            ? 'confirmed'
            : 'provisional'
          : 'confirmed';
        return createRdapResult(domain, tld, true, {
          verification,
          verificationNote:
            verification === 'provisional'
              ? 'RDAP said available; deep WHOIS verification was skipped for this high-pressure TLD.'
              : undefined,
        });
      }

      if (axiosError.response?.status === 429) {
        const retryAfter = Number(axiosError.response.headers?.['retry-after'] || 30);
        const seconds = Number.isFinite(retryAfter) ? retryAfter : 30;
        setHostCooldown(hostBucket, seconds);
        throw new RateLimitError(`RDAP ${hostBucket}`, seconds);
      }

      if (axiosError.response?.status && axiosError.response.status >= 500) {
        setHostCooldown(hostBucket, 20);
      }

      rdapErrorCache.set(errorKey, true, RDAP_ERROR_TTL_MS);
      throw new RegistrarApiError(
        'rdap',
        axiosError.message,
        axiosError.response?.status,
        error,
      );
    }

    rdapErrorCache.set(errorKey, true, RDAP_ERROR_TTL_MS);
    setHostCooldown(hostBucket, 15);
    throw new RegistrarApiError(
      'rdap',
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
}

/**
 * Calculate days until expiration from an ISO date string.
 */
function calculateDaysUntilExpiration(expiresAt: string): number | undefined {
  try {
    const expirationDate = new Date(expiresAt);
    const now = new Date();
    const diffMs = expirationDate.getTime() - now.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    return diffDays;
  } catch {
    return undefined;
  }
}

/**
 * Create a standardized result from RDAP.
 */
function createRdapResult(
  domain: string,
  tld: string,
  available: boolean,
  dates?: {
    registeredAt?: string;
    expiresAt?: string;
    verification?: VerificationStatus;
    verificationNote?: string;
  },
): DomainResult {
  const result: DomainResult = {
    domain: `${domain}.${tld}`,
    available,
    status: available ? 'available' : 'taken',
    premium: false, // RDAP doesn't tell us about premium status
    price_first_year: null, // RDAP doesn't provide pricing
    price_renewal: null,
    currency: 'USD',
    privacy_included: false,
    transfer_price: null,
    registrar: 'unknown',
    source: 'rdap',
    verification: dates?.verification || 'confirmed',
    verification_note: dates?.verificationNote,
    checked_at: new Date().toISOString(),
  };

  // Add registration and expiration dates if available
  if (dates?.registeredAt) {
    result.registered_at = dates.registeredAt;
  }

  if (dates?.expiresAt) {
    result.expires_at = dates.expiresAt;
    result.days_until_expiration = calculateDaysUntilExpiration(dates.expiresAt);
  }

  return result;
}

/**
 * Check if RDAP is available for a TLD (synchronous check).
 * Uses hardcoded servers only for quick check.
 */
export function isRdapAvailable(tld: string): boolean {
  // Use hardcoded servers for sync check
  // The async bootstrap will be tried during actual lookup
  return RDAP_SERVERS[tld] !== undefined;
}

/**
 * Pre-warm the RDAP bootstrap cache.
 *
 * Call this during server startup to avoid 5s cold-start latency
 * on the first RDAP lookup. Runs in background, doesn't block startup.
 *
 * @returns Promise that resolves when bootstrap is cached (or fails gracefully)
 */
export async function prewarmRdapBootstrap(): Promise<void> {
  try {
    // Trigger bootstrap fetch by looking up a TLD not in hardcoded list
    // This forces getRdapServer to fetch from IANA
    await getRdapServer('xyz');
    logger.info('RDAP bootstrap pre-warmed successfully');
  } catch (error) {
    // Non-fatal - first lookup will retry
    logger.warn('RDAP bootstrap pre-warm failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
