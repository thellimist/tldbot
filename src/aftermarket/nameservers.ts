/**
 * Aftermarket detection via nameserver fingerprints.
 *
 * Resolution strategy:
 * 1. Use `dig +short NS` when available for fast, shell-level DNS lookups.
 * 2. Fall back to Node's DNS resolver when `dig` is unavailable or fails.
 *
 * Results are cached because taken domains change slowly and DNS lookups
 * can be repeated frequently during bulk searches.
 */

import { execFile } from 'node:child_process';
import { resolveNs } from 'node:dns/promises';
import { promisify } from 'node:util';
import type { AftermarketInfo } from '../types.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { TtlCache } from '../utils/cache.js';

const execFileAsync = promisify(execFile);

type AftermarketListing = AftermarketInfo;

type NsFingerprint = {
  marketplace: string;
  source: string;
  type: 'aftermarket' | 'auction' | 'premium';
  patterns: string[];
  url?: (domain: string) => string;
  note?: string;
};

const NS_TIMEOUT_MS = config.aftermarket.nsTimeoutMs;
const nsCache = new TtlCache<AftermarketListing | null>(
  config.aftermarket.nsCacheTtl,
);

const NS_FINGERPRINTS: NsFingerprint[] = [
  {
    marketplace: 'Afternic',
    source: 'dns_ns',
    type: 'aftermarket',
    patterns: ['afternic.com', 'internettraffic.com'],
    url: (domain) =>
      `https://www.afternic.com/forsale/${encodeURIComponent(domain)}`,
    note: 'Nameserver indicates Afternic / GoDaddy aftermarket parking.',
  },
  {
    marketplace: 'Sedo',
    source: 'dns_ns',
    type: 'aftermarket',
    patterns: ['sedoparking.com'],
    url: (domain) =>
      `https://sedo.com/search/details/?domain=${encodeURIComponent(domain)}`,
    note: 'Nameserver indicates Sedo parking.',
  },
  {
    marketplace: 'GoDaddy',
    source: 'dns_ns',
    type: 'aftermarket',
    patterns: ['dan.com', 'undeveloped.com'],
    url: (domain) =>
      `https://www.afternic.com/forsale/${encodeURIComponent(domain)}`,
    note: 'Nameserver indicates a GoDaddy / Afternic listing (formerly Dan.com).',
  },
  {
    marketplace: 'Bodis',
    source: 'dns_ns',
    type: 'aftermarket',
    patterns: ['bodis.com'],
    url: (domain) => `https://www.bodis.com/domain/${encodeURIComponent(domain)}`,
    note: 'Nameserver indicates Bodis parking. Verify listing status manually.',
  },
  {
    marketplace: 'HugeDomains',
    source: 'dns_ns',
    type: 'aftermarket',
    patterns: ['hugedomains.com'],
    url: (domain) =>
      `https://www.hugedomains.com/domain_profile.cfm?d=${encodeURIComponent(domain)}`,
    note: 'Nameserver indicates HugeDomains inventory.',
  },
  {
    marketplace: 'ParkingCrew',
    source: 'dns_ns',
    type: 'aftermarket',
    patterns: ['parkingcrew.net'],
    url: (domain) =>
      `https://www.parkingcrew.net/domain/${encodeURIComponent(domain)}`,
    note: 'Nameserver indicates ParkingCrew parking. This is a lower-confidence resale signal.',
  },
  {
    marketplace: 'Domain Holdings',
    source: 'dns_ns',
    type: 'aftermarket',
    patterns: ['dsredirection.com'],
    note: 'Nameserver indicates domain holdings / redirection parking.',
  },
  {
    marketplace: 'GoDaddy Expired',
    source: 'dns_ns',
    type: 'auction',
    patterns: ['pendingrenewaldeletion.com'],
    url: (domain) =>
      `https://auctions.godaddy.com/trpSearchResults.aspx?domain=${encodeURIComponent(domain)}`,
    note: 'Nameserver indicates an expired GoDaddy domain heading to auction or deletion.',
  },
];

function normalizeNameserver(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, '');
}

function parseMoney(raw: string): number | null {
  const normalized = raw.replace(/[^0-9.]/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function extractHugeDomainsPrice(html: string): number | null {
  const patterns = [
    /buy now:<\/span>\s*<span[^>]*>\$([\d,]+(?:\.\d{2})?)/i,
    /<span class="price">\$([\d,]+(?:\.\d{2})?)<\/span>/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return parseMoney(match[1]);
    }
  }

  return null;
}

export function extractAfternicPrice(html: string): number | null {
  const patterns = [
    /"buyNowPrice"\s*:\s*(\d+(?:\.\d+)?)/i,
    /"buyNowPriceDisplay"\s*:\s*"\$([\d,]+(?:\.\d{2})?)"/i,
    /"minPriceDisplay"\s*:\s*"\$([\d,]+(?:\.\d{2})?)"/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return parseMoney(match[1]);
    }
  }

  return null;
}

async function fetchListingPrice(
  domain: string,
  marketplace: string,
  url: string | undefined,
): Promise<{ price: number | null; currency: string | null; note?: string }> {
  if (!url) {
    return { price: null, currency: null };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(NS_TIMEOUT_MS, 5000));

  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; tldbot/0.0.1)',
      },
    });

    if (!response.ok) {
      return { price: null, currency: null };
    }

    const html = await response.text();

    if (marketplace === 'HugeDomains') {
      return {
        price: extractHugeDomainsPrice(html),
        currency: 'USD',
        note: 'HugeDomains listing page price.',
      };
    }

    if (marketplace === 'Afternic' || marketplace === 'GoDaddy') {
      const price = extractAfternicPrice(html);
      return {
        price,
        currency: price === null ? null : 'USD',
        note: price === null
          ? undefined
          : 'GoDaddy / Afternic listing page price.',
      };
    }
  } catch (error) {
    logger.debug('Aftermarket price lookup failed', {
      domain,
      marketplace,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    clearTimeout(timeout);
  }

  return { price: null, currency: null };
}

function matchFingerprint(
  nameservers: string[],
  fingerprint: NsFingerprint,
): boolean {
  return nameservers.some((nameserver) =>
    fingerprint.patterns.some((pattern) => {
      const normalizedPattern = normalizeNameserver(pattern);
      return (
        nameserver === normalizedPattern ||
        nameserver.endsWith(`.${normalizedPattern}`) ||
        nameserver.includes(normalizedPattern)
      );
    }),
  );
}

async function resolveNsWithDig(domain: string): Promise<string[]> {
  const { stdout } = await execFileAsync(
    'dig',
    ['+short', 'NS', domain],
    {
      timeout: NS_TIMEOUT_MS,
      maxBuffer: 64 * 1024,
    },
  );

  return stdout
    .split('\n')
    .map(normalizeNameserver)
    .filter(Boolean);
}

async function resolveNsWithNode(domain: string): Promise<string[]> {
  const timeout = new Promise<string[]>((_, reject) => {
    setTimeout(() => reject(new Error('ns_timeout')), NS_TIMEOUT_MS);
  });

  return Promise.race([
    resolveNs(domain).then((entries) => entries.map(normalizeNameserver)),
    timeout,
  ]);
}

async function resolveNameservers(domain: string): Promise<string[]> {
  try {
    const viaDig = await resolveNsWithDig(domain);
    if (viaDig.length > 0) {
      return viaDig;
    }
  } catch (error) {
    logger.debug('dig nameserver lookup failed, falling back to node:dns', {
      domain,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return resolveNsWithNode(domain);
}

async function detectHugeDomainsLander(
  domain: string,
): Promise<AftermarketListing | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NS_TIMEOUT_MS);

  try {
    const response = await fetch(`https://${domain}`, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'tldbot/0.0.1',
      },
    });

    const html = (await response.text()).toLowerCase();
    const normalizedDomain = domain.toLowerCase();

    if (
      html.includes(`<title>${normalizedDomain} is for sale | hugedomains`) ||
      (html.includes('this domain is for sale') && html.includes('hugedomains'))
    ) {
      const price = extractHugeDomainsPrice(html);
      return {
        type: 'aftermarket',
        price,
        currency: price === null ? null : 'USD',
        source: 'landing_page',
        marketplace: 'HugeDomains',
        url: `https://www.hugedomains.com/domain_profile.cfm?d=${encodeURIComponent(domain)}`,
        note: price === null
          ? 'HugeDomains sale lander detected.'
          : 'HugeDomains sale lander with listing price detected.',
      };
    }
  } catch (error) {
    logger.debug('Landing page aftermarket lookup failed', {
      domain,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    clearTimeout(timeout);
  }

  return null;
}

export async function lookupAftermarketByNameserver(
  domain: string,
): Promise<AftermarketListing | null> {
  if (!config.aftermarket.nsEnabled) {
    return null;
  }

  const key = domain.toLowerCase();
  const cached = nsCache.get(key);
  if (cached !== undefined) {
    return cached;
  }

  try {
    const nameservers = await resolveNameservers(domain);

    for (const fingerprint of NS_FINGERPRINTS) {
      if (!matchFingerprint(nameservers, fingerprint)) {
        continue;
      }

      const listing: AftermarketListing = {
        type: fingerprint.type,
        price: null,
        currency: null,
        source: fingerprint.source,
        marketplace: fingerprint.marketplace,
        url: fingerprint.url ? fingerprint.url(domain) : undefined,
        note: fingerprint.note,
      };

      const priceInfo = await fetchListingPrice(
        domain,
        fingerprint.marketplace,
        listing.url,
      );
      if (priceInfo.price !== null) {
        listing.price = priceInfo.price;
        listing.currency = priceInfo.currency;
        listing.note = priceInfo.note || listing.note;
      }

      nsCache.set(key, listing);
      return listing;
    }

    const landerListing = await detectHugeDomainsLander(domain);
    if (landerListing) {
      nsCache.set(key, landerListing);
      return landerListing;
    }
  } catch (error) {
    logger.debug('Nameserver aftermarket lookup failed', {
      domain,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  nsCache.set(key, null);
  return null;
}
