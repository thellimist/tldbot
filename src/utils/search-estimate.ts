const DEFAULT_TLD_MS = 950;

const TLD_ESTIMATES_MS: Record<string, number> = {
  com: 700,
  net: 700,
  org: 700,
  io: 900,
  dev: 800,
  app: 800,
  co: 900,
  ai: 1300,
  sh: 1300,
  so: 1100,
  tools: 1000,
  studio: 1000,
  company: 1000,
};

function humanizeMs(value: number): string {
  if (value < 1000) {
    return `${value}ms`;
  }

  const seconds = value / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainderSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainderSeconds}s`;
}

export function estimateTldDurationMs(tld: string): number {
  return TLD_ESTIMATES_MS[tld.toLowerCase()] ?? DEFAULT_TLD_MS;
}

export function estimateSearchDuration(
  tlds: string[],
  pricingEnabled: boolean,
  concurrency: number,
): {
  estimated_duration_ms: number;
  estimated_duration_label: string;
} {
  const baseMs = tlds.reduce(
    (sum, tld) => sum + estimateTldDurationMs(tld),
    0,
  );
  const pricingPenaltyMs = pricingEnabled ? tlds.length * 250 : 0;
  const parallelism = Math.max(1, Math.min(concurrency, tlds.length || 1));
  const estimatedDurationMs = Math.max(
    250,
    Math.ceil((baseMs + pricingPenaltyMs) / parallelism),
  );

  return {
    estimated_duration_ms: estimatedDurationMs,
    estimated_duration_label: humanizeMs(estimatedDurationMs),
  };
}

export function estimateBulkDuration(
  domainCount: number,
  tld: string,
  concurrency: number,
  pricingEnabled: boolean,
): {
  estimated_duration_ms: number;
  estimated_duration_label: string;
} {
  const perDomainMs = estimateTldDurationMs(tld) + (pricingEnabled ? 150 : 0);
  const estimatedDurationMs = Math.max(
    500,
    Math.ceil((domainCount * perDomainMs) / Math.max(1, concurrency)),
  );

  return {
    estimated_duration_ms: estimatedDurationMs,
    estimated_duration_label: humanizeMs(estimatedDurationMs),
  };
}

export function formatRemainingEstimate(
  completed: number,
  total: number,
  startedAt: number,
): string {
  if (completed <= 0 || total <= 0 || completed >= total) {
    return 'almost done';
  }

  const elapsedMs = Date.now() - startedAt;
  const avgMs = elapsedMs / completed;
  const remainingMs = Math.ceil(avgMs * (total - completed));
  return humanizeMs(remainingMs);
}
