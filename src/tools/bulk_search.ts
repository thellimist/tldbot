/**
 * bulk_search Tool - Search Multiple Domains.
 *
 * Efficiently check availability for many domain names at once.
 * Uses concurrent requests with rate limiting.
 */

import { z } from 'zod';
import type { DomainResult } from '../types.js';
import { bulkSearchDomains } from '../services/domain-search.js';
import { wrapError } from '../utils/errors.js';
import { estimateBulkDuration } from '../utils/search-estimate.js';
import { config } from '../config.js';

/**
 * Input schema for bulk_search.
 */
export const bulkSearchSchema = z.object({
  domains: z
    .array(z.string())
    .min(1)
    .max(100)
    .describe(
      "List of domain names to check (e.g., ['vibecoding', 'myapp', 'coolstartup']). Max 100 domains.",
    ),
  tld: z
    .string()
    .optional()
    .default('com')
    .describe("Single TLD to check for all domains (e.g., 'com'). Defaults to 'com'."),
  registrar: z
    .string()
    .optional()
    .describe(
      "Optional: specific registrar to use (BYOK only; ignored when Pricing API is configured).",
    ),
});

export type BulkSearchInput = z.infer<typeof bulkSearchSchema>;

/**
 * Tool definition for MCP.
 */
export const bulkSearchTool = {
  name: 'bulk_search',
  description: `Check availability for multiple domain names at once.

Efficiently searches up to 100 domains in parallel with rate limiting.
Use a single TLD for best performance.

Returns:
- Availability status for each domain
- Pricing where available
- Summary statistics

Example:
- bulk_search(["vibecoding", "myapp", "coolstartup"], "io")`,
  inputSchema: {
    type: 'object',
    properties: {
      domains: {
        type: 'array',
        items: { type: 'string' },
        description:
          "List of domain names to check. Don't include extensions. Max 100.",
      },
      tld: {
        type: 'string',
        description: "TLD to check for all domains (e.g., 'com'). Defaults to 'com'.",
      },
      registrar: {
        type: 'string',
        description: "Optional: specific registrar to use (BYOK only).",
      },
    },
    required: ['domains'],
  },
};

/**
 * Response format for bulk search.
 */
interface BulkSearchResponse {
  results: DomainResult[];
  estimate: {
    estimated_duration_ms: number;
    estimated_duration_label: string;
  };
  summary: {
    total: number;
    available: number;
    for_sale: number;
    taken: number;
    errors: number;
  };
  insights: string[];
}

/**
 * Execute the bulk_search tool.
 */
export async function executeBulkSearch(
  input: BulkSearchInput,
): Promise<BulkSearchResponse> {
  try {
    const { domains, tld, registrar } = bulkSearchSchema.parse(input);
    const estimate = estimateBulkDuration(
      domains.length,
      tld,
      20,
      config.pricingApi.enabled,
    );

    const results = await bulkSearchDomains(domains, tld, registrar);

    const available = results.filter((r) => r.status === 'available');
    const forSale = results.filter((r) => r.status === 'for_sale');
    const taken = results.filter((r) => r.status === 'taken');

    const insights: string[] = [];

    if (available.length > 0) {
      insights.push(
        `✅ ${available.length} of ${domains.length} domains available`,
      );

      const cheapest = available
        .filter(
          (r) => r.price_first_year !== null && r.pricing_status === 'ok',
        )
        .sort((a, b) => a.price_first_year! - b.price_first_year!)[0];

      if (cheapest) {
        insights.push(
          `💰 Best price: ${cheapest.domain} at $${cheapest.price_first_year}/year`,
        );
        if (cheapest.price_check_url) {
          insights.push(
            `Verify pricing for ${cheapest.domain}: ${cheapest.price_check_url}`,
          );
        }
      }
    } else {
      if (forSale.length > 0) {
        insights.push(`💰 ${forSale.length} domain${forSale.length > 1 ? 's are' : ' is'} listed for resale`);
      }
      if (taken.length > 0) {
        insights.push(`❌ ${taken.length} domain${taken.length > 1 ? 's are' : ' is'} taken`);
      }
      insights.push('💡 Try different variations or alternative TLDs');
    }

    insights.push(
      '⚠️ Prices can change. Verify at registrar checkout links before purchase.',
    );

    return {
      results,
      estimate,
      summary: {
        total: domains.length,
        available: available.length,
        for_sale: forSale.length,
        taken: taken.length,
        errors: domains.length - results.length,
      },
      insights,
    };
  } catch (error) {
    throw wrapError(error);
  }
}
