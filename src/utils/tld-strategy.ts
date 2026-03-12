import type { VerificationMode } from '../types.js';

const HIGH_PRESSURE_TLDS = new Set([
  'dev',
  'app',
  'io',
  'ai',
  'sh',
  'ac',
  'so',
  'bot',
]);

export function isHighPressureTld(tld: string): boolean {
  return HIGH_PRESSURE_TLDS.has(tld.toLowerCase());
}

export function getTldPressureBucket(
  tld: string,
  serverHost?: string,
): string {
  const normalizedTld = tld.toLowerCase();
  const normalizedHost = (serverHost || '').toLowerCase();

  if (normalizedHost.includes('nic.google')) return 'rdap-google';
  if (normalizedHost.includes('nic.io')) return 'rdap-io';
  if (normalizedHost.includes('nic.ai')) return 'rdap-ai';
  if (normalizedHost.includes('nic.sh')) return 'rdap-sh';
  if (normalizedHost.includes('nic.so')) return 'rdap-so';
  if (normalizedHost.includes('nominet.uk')) return 'rdap-nominet';

  if (isHighPressureTld(normalizedTld)) {
    return `rdap-${normalizedTld}`;
  }

  return normalizedHost || `rdap-${normalizedTld}`;
}

export function shouldUseStrictVerification(
  tld: string,
  mode: VerificationMode,
): boolean {
  if (mode === 'strict') return true;
  if (mode === 'fast') return false;
  return !isHighPressureTld(tld);
}
