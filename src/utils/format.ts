import type {
  Config,
  DomainResult,
  SearchResponse,
  TLDInfo,
  SocialHandleResult,
  PurchaseResult,
} from '../types.js';
import { CLI_COMMAND } from './cli-command.js';

type OutputFormat = Config['outputFormat'];

type ToolResult =
  | SearchResponse
  | { results: DomainResult[]; summary?: Record<string, number>; insights?: string[] }
  | { suggestions: Array<{ domain: string; price_first_year: number | null; registrar: string; score: number }>; insights?: string[] }
  | { results: { available: DomainResult[]; premium: DomainResult[]; unavailable_count: number }; insights?: string[] }
  | { name: string; results: SocialHandleResult[]; insights?: string[] }
  | PurchaseResult
  | TLDInfo
  | Record<string, unknown>;

function formatMoney(value: number | null, currency: string): string {
  if (value === null || Number.isNaN(value)) return 'N/A';
  return `${currency} ${value.toFixed(2)}`;
}

function formatPriceSummary(result: DomainResult): string {
  if (result.price_first_year === null) return 'N/A';
  const first = formatPriceFirstYear(result);
  if (result.price_renewal === null) {
    return first;
  }
  const renewal = formatRenewalPrice(result);
  return `${first} / ${renewal} renew`;
}

function getPriceConfidenceLabel(result: DomainResult): 'estimated' | null {
  if (result.status === 'for_sale' && result.aftermarket?.price !== null) {
    return null;
  }

  if (result.pricing_status === 'ok') {
    return null;
  }

  if (
    result.pricing_status === 'partial' ||
    result.pricing_status === 'catalog_only'
  ) {
    return 'estimated';
  }

  if (
    result.price_first_year !== null ||
    result.price_renewal !== null
  ) {
    return 'estimated';
  }

  return null;
}

function formatPriceFirstYear(result: DomainResult): string {
  if (result.price_first_year === null) return 'N/A';
  const label = getPriceConfidenceLabel(result);
  const money = formatMoney(result.price_first_year, result.currency);
  return label ? `${money} (${label})` : money;
}

function formatRenewalPrice(result: DomainResult): string {
  if (result.price_renewal === null) return 'N/A';
  const label = getPriceConfidenceLabel(result);
  const money = formatMoney(result.price_renewal, result.currency);
  return label ? `${money} (${label})` : money;
}

function formatLinks(result: DomainResult): string {
  const links: string[] = [];
  if (result.checkout_url) {
    links.push(`[buy](${result.checkout_url})`);
  }
  if (result.price_check_url) {
    links.push(`[price](${result.price_check_url})`);
  }
  if (result.aftermarket?.url) {
    const label = result.aftermarket.marketplace || result.aftermarket.type;
    links.push(`[${label}](${result.aftermarket.url})`);
  }
  return links.length > 0 ? links.join(' ') : '-';
}

function renderTable(headers: string[], rows: string[][]): string {
  const headerRow = `| ${headers.join(' | ')} |`;
  const separator = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => `| ${row.join(' | ')} |`).join('\n');
  return [headerRow, separator, body].filter(Boolean).join('\n');
}

function formatDomainResultsTable(results: DomainResult[]): string {
  const headers = ['Domain', 'Status', 'Where'];
  const rows = results.map((result) => [
    result.domain,
    result.status === 'available'
      ? 'Available'
      : result.status === 'for_sale'
      ? 'For Sale'
      : 'Taken',
    result.marketplace || result.registrar || 'unknown',
  ]);
  return renderTable(headers, rows);
}

function formatSearchResponse(result: SearchResponse): string {
  const sections: string[] = [];
  const available = result.results.filter((entry) => entry.status === 'available');
  const forSale = result.results.filter((entry) => entry.status === 'for_sale');
  const taken = result.results.filter((entry) => entry.status === 'taken');

  sections.push(
    `Search summary: ${available.length} available, ${forSale.length} for sale, ${taken.length} taken`,
  );
  if (result.estimate) {
    sections.push(
      `Estimated: ${result.estimate.estimated_duration_label} | Actual: ${Math.max(0.1, Math.round(result.duration_ms / 100) / 10)}s`,
    );
  }
  if (available.length > 0) {
    sections.push('\nAvailable');
    sections.push(formatDomainResultsTable(available));
  }
  if (forSale.length > 0) {
    sections.push('\nFor Sale');
    sections.push(formatDomainResultsTable(forSale));
  }
  if (taken.length > 0) {
    sections.push('\nTaken');
    sections.push(formatDomainResultsTable(taken));
  }
  if (result.non_verified_domains?.length) {
    sections.push(`\nNon-verified: ${result.non_verified_domains.join(', ')}`);
  }
  if (result.next_steps?.length) {
    sections.push(`\nNext commands:\n- ${result.next_steps.join('\n- ')}`);
  }
  return sections.join('\n');
}

function formatBulkResponse(result: {
  results: DomainResult[];
  estimate?: { estimated_duration_ms: number; estimated_duration_label: string };
  summary?: Record<string, number>;
  insights?: string[];
}): string {
  const sections: string[] = [];
  const available = result.results.filter((entry) => entry.status === 'available');
  const forSale = result.results.filter((entry) => entry.status === 'for_sale');
  const taken = result.results.filter((entry) => entry.status === 'taken');
  if (result.summary) {
    const summaryParts = Object.entries(result.summary)
      .map(([key, value]) => `${key}: ${value}`)
      .join(', ');
    sections.push(`Summary: ${summaryParts}`);
  }
  if (result.estimate) {
    sections.push(`Estimated duration: ${result.estimate.estimated_duration_label}`);
  }
  if (available.length > 0) {
    sections.push('\nAvailable');
    sections.push(formatDomainResultsTable(available));
  }
  if (forSale.length > 0) {
    sections.push('\nFor Sale');
    sections.push(formatDomainResultsTable(forSale));
  }
  if (taken.length > 0) {
    sections.push('\nTaken');
    sections.push(formatDomainResultsTable(taken));
  }
  return sections.join('\n');
}

function formatSuggestions(result: {
  suggestions: Array<{ domain: string; price_first_year: number | null; registrar: string; score: number }>;
  insights?: string[];
}): string {
  const headers = ['Domain', 'Price', 'Registrar', 'Score'];
  const rows = result.suggestions.map((entry) => [
    entry.domain,
    entry.price_first_year === null ? 'N/A' : formatMoney(entry.price_first_year, 'USD'),
    entry.registrar || 'unknown',
    entry.score.toString(),
  ]);
  const sections: string[] = [];
  sections.push(renderTable(headers, rows));
  return sections.join('\n');
}

function formatSmartSuggestions(result: {
  results: { available: DomainResult[]; premium: DomainResult[]; unavailable_count: number };
  insights?: string[];
}): string {
  const sections: string[] = [];
  if (result.results.available.length > 0) {
    sections.push('Available');
    sections.push(formatDomainResultsTable(result.results.available));
  }
  if (result.results.premium.length > 0) {
    sections.push('\nPremium');
    sections.push(formatDomainResultsTable(result.results.premium));
  }
  if (result.results.unavailable_count > 0) {
    sections.push(`\nUnavailable: ${result.results.unavailable_count}`);
  }
  return sections.join('\n');
}

function formatTldInfo(result: TLDInfo): string {
  const headers = ['Field', 'Value'];
  const rows = [
    ['TLD', `.${result.tld}`],
    ['Description', result.description],
    ['Typical use', result.typical_use],
    [
      'Price range',
      `${result.price_range.currency} ${result.price_range.min}-${result.price_range.max}`,
    ],
    [
      'Renewal',
      `${result.price_range.currency} ${result.renewal_price_typical}`,
    ],
    ['Restrictions', result.restrictions.length > 0 ? result.restrictions.join(', ') : 'None'],
    ['Popularity', result.popularity],
    ['Category', result.category],
  ];
  return renderTable(headers, rows);
}

function formatSocials(result: { name: string; results: SocialHandleResult[]; insights?: string[] }): string {
  const headers = ['Platform', 'Status'];
  const rows = result.results.map((entry) => [
    entry.platform,
    entry.status,
  ]);
  const summary = {
    available: result.results.filter((entry) => entry.status === 'available').length,
    taken: result.results.filter((entry) => entry.status === 'taken').length,
    unknown: result.results.filter((entry) => entry.status === 'unknown').length,
  };

  return [
    `Social summary: ${summary.available} available, ${summary.taken} taken, ${summary.unknown} unknown`,
    renderTable(headers, rows),
  ].join('\n');
}

function getPurchasePriceConfidenceLabel(result: PurchaseResult): 'estimated' | null {
  if (result.status === 'for_sale' && result.aftermarket?.price !== null) {
    return null;
  }

  if (result.pricing_status === 'ok') {
    return null;
  }

  if (
    result.pricing_status === 'partial' ||
    result.pricing_status === 'catalog_only'
  ) {
    return 'estimated';
  }

  if (
    result.price_first_year !== null ||
    result.price_renewal !== null
  ) {
    return 'estimated';
  }

  return null;
}

function formatPurchasePrice(
  value: number | null,
  currency: string,
  result: PurchaseResult,
): string {
  if (value === null || Number.isNaN(value)) return 'N/A';
  const label = getPurchasePriceConfidenceLabel(result);
  const money = formatMoney(value, currency);
  return label ? `${money} (${label})` : money;
}

function formatPurchaseDomain(result: PurchaseResult): string {
  const lines: string[] = [];

  if (result.mode === 'marketplace') {
    lines.push(
      `Buy ${result.domain} from ${result.marketplace || result.registrar || 'marketplace'}`,
    );
    if (result.price_first_year !== null) {
      lines.push(`Price ${formatPurchasePrice(result.price_first_year, result.currency, result)}`);
    }
    if (result.checkout_command) {
      lines.push(result.checkout_command);
    } else if (result.checkout_url) {
      lines.push(result.checkout_url);
    }
    return lines.join('\n');
  }

  if (result.registrar && result.checkout_command) {
    lines.push(`Buy ${result.domain} via ${result.registrar}`);
    if (result.price_first_year !== null) {
      const renewal = result.price_renewal === null
        ? ''
        : ` | Renew ${formatPurchasePrice(result.price_renewal, result.currency, result)}`;
      lines.push(`Price ${formatPurchasePrice(result.price_first_year, result.currency, result)}${renewal}`);
    }
    lines.push(result.checkout_command);
    return lines.join('\n');
  }

  lines.push(`Buy ${result.domain}`);
  if (result.price_first_year !== null) {
    const renewal = result.price_renewal === null
      ? ''
      : ` | Renew ${formatPurchasePrice(result.price_renewal, result.currency, result)}`;
    lines.push(`Estimated ${formatPurchasePrice(result.price_first_year, result.currency, result)}${renewal}`);
  }
  for (const option of result.options || []) {
    lines.push(`- ${option.registrar}: ${option.checkout_command}`);
  }
  return lines.join('\n');
}

export function formatToolResult(
  name: string,
  result: unknown,
  format: OutputFormat,
): string {
  const typed = result as ToolResult;
  if (format === 'json') {
    return JSON.stringify(typed, null, 2);
  }

  let text = '';

  switch (name) {
    case 'search':
      text = formatSearchResponse(typed as SearchResponse);
      break;
    case 'buy':
      text = formatPurchaseDomain(typed as PurchaseResult);
      break;
    case 'bulk_search':
      text = formatBulkResponse(typed as { results: DomainResult[]; summary?: Record<string, number>; insights?: string[] });
      break;
    case 'suggest_domains':
      text = formatSuggestions(typed as {
        suggestions: Array<{ domain: string; price_first_year: number | null; registrar: string; score: number }>;
        insights?: string[];
      });
      break;
    case 'suggest_domains_smart':
      text = formatSmartSuggestions(typed as {
        results: { available: DomainResult[]; premium: DomainResult[]; unavailable_count: number };
        insights?: string[];
      });
      break;
    case 'tld_info':
      text = formatTldInfo(typed as TLDInfo);
      break;
    case 'check_socials':
      text = formatSocials(typed as { name: string; results: SocialHandleResult[]; insights?: string[] });
      break;
    default:
      text = `Output format not implemented for ${name}. Set OUTPUT_FORMAT=json for raw output.`;
  }

  if (format === 'both') {
    return `${text}\n\n\`\`\`json\n${JSON.stringify(typed, null, 2)}\n\`\`\``;
  }

  return text;
}

export function formatToolError(
  error: { code?: string; userMessage?: string; retryable?: boolean; suggestedAction?: string },
  format: OutputFormat,
): string {
  const payload = {
    error: true,
    code: error.code || 'unknown',
    message: error.userMessage || 'Unknown error',
    retryable: error.retryable ?? false,
    suggestedAction: error.suggestedAction,
  };

  if (format === 'json' || format === 'both') {
    const json = JSON.stringify(payload, null, 2);
    return format === 'both'
      ? `Error:\n${payload.message}\n\n\`\`\`json\n${json}\n\`\`\``
      : json;
  }

  const lines = [
    `Error: ${payload.message}`,
    `Code: ${payload.code}`,
    `Retryable: ${payload.retryable ? 'yes' : 'no'}`,
  ];
  if (payload.suggestedAction) {
    lines.push(`Suggested action: ${payload.suggestedAction}`);
  }
  return lines.join('\n');
}
