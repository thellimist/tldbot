/**
 * tld_info Tool - TLD Information.
 *
 * Get information about a Top Level Domain (TLD).
 * Includes pricing, restrictions, and recommendations.
 */

import { z } from 'zod';
import type { TLDInfo } from '../types.js';
import { validateTld } from '../utils/validators.js';
import { wrapError } from '../utils/errors.js';
import { tldCache, tldCacheKey } from '../utils/cache.js';
import { TLD_DATABASE, getTldCatalogEntry } from '../utils/tld-catalog.js';

/**
 * Input schema for tld_info.
 */
export const tldInfoSchema = z.object({
  tld: z
    .string()
    .min(2)
    .max(63)
    .describe("The TLD to get information about (e.g., 'com', 'io', 'dev')."),
  detailed: z
    .boolean()
    .optional()
    .default(false)
    .describe("Whether to include detailed information. Defaults to false."),
});

export type TldInfoInput = z.infer<typeof tldInfoSchema>;

/**
 * Tool definition for MCP.
 */
export const tldInfoTool = {
  name: 'tld_info',
  description: `Get information about a Top Level Domain (TLD).

Returns:
- Description and typical use case
- Price range
- Any special restrictions
- Popularity and recommendations

Example:
- tld_info("io") → info about .io domains`,
  inputSchema: {
    type: 'object',
    properties: {
      tld: {
        type: 'string',
        description: "The TLD to get info about (e.g., 'com', 'io', 'dev').",
      },
      detailed: {
        type: 'boolean',
        description: "Include detailed information. Defaults to false.",
      },
    },
    required: ['tld'],
  },
};

/**
 * Response format for TLD info.
 */
interface TldInfoResponse extends TLDInfo {
  insights: string[];
  recommendation: string;
}

/**
 * Execute the tld_info tool.
 */
export async function executeTldInfo(
  input: TldInfoInput,
): Promise<TldInfoResponse> {
  try {
    const { tld, detailed } = tldInfoSchema.parse(input);
    const normalizedTld = validateTld(tld);

    // Check cache
    const cacheKey = tldCacheKey(normalizedTld);
    const cached = tldCache.get(cacheKey);
    if (cached) {
      return formatResponse(cached, detailed);
    }

    // Look up in database
    const info = TLD_DATABASE[normalizedTld];

    if (!info) {
      return formatResponse(getTldCatalogEntry(normalizedTld), detailed);
    }

    // Cache the result
    tldCache.set(cacheKey, info);

    return formatResponse(info, detailed);
  } catch (error) {
    throw wrapError(error);
  }
}

/**
 * Format the response with insights.
 */
function formatResponse(info: TLDInfo, detailed: boolean): TldInfoResponse {
  const insights: string[] = [];
  let recommendation = '';

  // Generate insights
  if (info.popularity === 'high') {
    insights.push(`✅ .${info.tld} is highly recognized and trusted`);
  } else if (info.popularity === 'medium') {
    insights.push(`💡 .${info.tld} is gaining popularity in specific niches`);
  } else {
    insights.push(`⚠️ .${info.tld} is less common - may need more brand building`);
  }

  if (info.restrictions.length > 0) {
    insights.push(`⚠️ Special requirements: ${info.restrictions.join(', ')}`);
  }

  if (info.price_range.min <= 10) {
    insights.push(`💰 Budget-friendly starting at $${info.price_range.min}/year`);
  } else if (info.price_range.min >= 40) {
    insights.push(`💸 Premium pricing starting at $${info.price_range.min}/year`);
  }

  // Generate recommendation
  switch (info.tld) {
    case 'com':
      recommendation = 'Best for mainstream businesses and maximum recognition';
      break;
    case 'io':
      recommendation = 'Perfect for tech startups and SaaS products';
      break;
    case 'dev':
      recommendation = 'Ideal for developers and tech portfolios (requires HTTPS)';
      break;
    case 'app':
      recommendation = 'Great for mobile/web applications (requires HTTPS)';
      break;
    case 'ai':
      recommendation = 'Trending choice for AI/ML projects, but pricey';
      break;
    case 'bot':
      recommendation = 'Good fit for AI agents, chatbots, and automation products';
      break;
    default:
      recommendation = `Good choice for ${info.typical_use.toLowerCase()}`;
  }

  return {
    ...info,
    insights,
    recommendation,
  };
}
