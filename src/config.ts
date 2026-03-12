/**
 * Configuration loader for tldbot.
 *
 * Loads one optional JSON config file from --config and merges it with
 * built-in defaults.
 */

import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import type { CheckoutRegistrar, Config } from './types.js';

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends Array<infer U>
    ? U[]
    : T[K] extends object
    ? DeepPartial<T[K]>
    : T[K];
};

export const DEFAULT_CONFIG: Config = {
  pricingApi: {
    enabled: false,
  },
  cache: {
    availabilityTtl: 86400,
  },
  defaultSearchTlds: ['com', 'io', 'dev', 'app', 'co', 'net', 'ai', 'sh', 'so'],
  allowedTlds: [
    'com',
    'io',
    'dev',
    'app',
    'co',
    'net',
    'org',
    'xyz',
    'ai',
    'sh',
    'so',
    'tools',
    'studio',
    'company',
    'me',
    'cc',
    'bot',
  ],
  aftermarket: {
    sedoEnabled: true,
    nsEnabled: true,
  },
  checkout: {
    enabled: true,
    defaultRegistrar: 'namecheap',
  },
};

function getArgValue(flag: string, args: string[] = process.argv.slice(2)): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

export function resolveConfigPath(args: string[] = process.argv.slice(2)): string | undefined {
  const configPath = getArgValue('--config', args);
  if (!configPath) {
    return undefined;
  }
  return resolve(process.cwd(), configPath);
}

export function getRuntimeStateDir(args: string[] = process.argv.slice(2)): string {
  const configPath = resolveConfigPath(args);
  if (configPath) {
    return join(dirname(configPath), '.tldbot');
  }
  return join(homedir(), '.tldbot');
}

function mergeDeep<T extends object>(base: T, override: DeepPartial<T> | undefined): T {
  if (!override) {
    return structuredClone(base);
  }

  const output = structuredClone(base) as Record<string, unknown>;

  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;

    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      output[key] &&
      typeof output[key] === 'object' &&
      !Array.isArray(output[key])
    ) {
      output[key] = mergeDeep(
        output[key] as Record<string, unknown>,
        value as DeepPartial<Record<string, unknown>>,
      );
      continue;
    }

    output[key] = value;
  }

  return output as T;
}

function parseCheckoutRegistrar(value: unknown): CheckoutRegistrar {
  switch (String(value || '').toLowerCase()) {
    case 'cloudflare':
    case 'godaddy':
      return String(value).toLowerCase() as CheckoutRegistrar;
    case 'namecheap':
    default:
      return 'namecheap';
  }
}

/**
 * SECURITY: Validate external URLs to prevent SSRF attacks.
 */
function validateExternalUrl(
  url: string | undefined,
  allowLocalhost: boolean = false,
): string | undefined {
  if (!url) return undefined;

  try {
    const parsed = new URL(url);

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return undefined;
    }

    const hostname = parsed.hostname.toLowerCase();
    const suspiciousPatterns = [
      /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+\./,
      /\.internal$/i,
      /\.local$/i,
      /\.localhost$/i,
      /\.corp$/i,
      /\.home$/i,
      /\.lan$/i,
    ];

    for (const pattern of suspiciousPatterns) {
      if (pattern.test(hostname)) {
        return undefined;
      }
    }

    const forbiddenHosts = ['localhost', '127.0.0.1', '0.0.0.0', '[::1]', '::1'];
    if (forbiddenHosts.includes(hostname) && !allowLocalhost) {
      return undefined;
    }

    const privateRanges = [
      /^10\./,
      /^172\.(1[6-9]|2[0-9]|3[01])\./,
      /^192\.168\./,
      /^169\.254\./,
      /^fc00:/i,
      /^fe80:/i,
      /^fd[0-9a-f]{2}:/i,
    ];

    for (const range of privateRanges) {
      if (range.test(hostname)) {
        return undefined;
      }
    }

    const isLocalhost = forbiddenHosts.includes(hostname);
    if (parsed.protocol === 'http:' && !isLocalhost) {
      const allowedHttpHosts = ['95.111.240.197'];
      if (!allowedHttpHosts.includes(hostname)) {
        return undefined;
      }
    }

    return url;
  } catch {
    return undefined;
  }
}

function loadConfigOverrides(): DeepPartial<Config> {
  const configPath = resolveConfigPath();
  if (!configPath) {
    return {};
  }

  const raw = readFileSync(configPath, 'utf8');
  return JSON.parse(raw) as DeepPartial<Config>;
}

function finalizeConfig(input: Config): Config {
  const pricingApiBaseUrl = validateExternalUrl(input.pricingApi.baseUrl);

  return {
    ...input,
    pricingApi: {
      ...input.pricingApi,
      baseUrl: pricingApiBaseUrl,
      enabled: input.pricingApi.enabled || Boolean(pricingApiBaseUrl),
    },
    checkout: {
      ...input.checkout,
      defaultRegistrar: parseCheckoutRegistrar(input.checkout.defaultRegistrar),
    },
  };
}

export function loadConfig(): Config {
  const overrides = loadConfigOverrides();
  return finalizeConfig(mergeDeep(DEFAULT_CONFIG, overrides));
}

export const config = loadConfig();

export function hasRegistrarApi(): boolean {
  return config.pricingApi.enabled;
}

export function getAvailableSources(): string[] {
  const sources: string[] = [];
  if (config.pricingApi.enabled) sources.push('pricing_api');
  sources.push('rdap', 'whois');
  return sources;
}
