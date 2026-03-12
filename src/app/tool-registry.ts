import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ZodType } from 'zod';
import {
  searchDomainTool,
  searchDomainSchema,
  executeSearchDomain,
  purchaseDomainTool,
  purchaseDomainSchema,
  executePurchaseDomain,
  bulkSearchTool,
  bulkSearchSchema,
  executeBulkSearch,
  suggestDomainsTool,
  suggestDomainsSchema,
  executeSuggestDomains,
  suggestDomainsSmartTool,
  suggestDomainsSmartSchema,
  executeSuggestDomainsSmart,
  tldInfoTool,
  tldInfoSchema,
  executeTldInfo,
  checkSocialsTool,
  checkSocialsSchema,
  executeCheckSocials,
  analyzeProjectTool,
  analyzeProjectSchema,
  executeAnalyzeProject,
  huntDomainsTool,
  huntDomainsSchema,
  executeHuntDomains,
} from '../tools/index.js';
import { DomainSearchError } from '../utils/errors.js';

export interface RegisteredTool {
  name: string;
  tool: Tool;
  schema: ZodType;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

export const REGISTERED_TOOLS: RegisteredTool[] = [
  { name: 'search_domain', tool: searchDomainTool as Tool, schema: searchDomainSchema, execute: executeSearchDomain as RegisteredTool['execute'] },
  { name: 'purchase_domain', tool: purchaseDomainTool as Tool, schema: purchaseDomainSchema, execute: executePurchaseDomain as RegisteredTool['execute'] },
  { name: 'bulk_search', tool: bulkSearchTool as Tool, schema: bulkSearchSchema, execute: executeBulkSearch as RegisteredTool['execute'] },
  { name: 'suggest_domains', tool: suggestDomainsTool as Tool, schema: suggestDomainsSchema, execute: executeSuggestDomains as RegisteredTool['execute'] },
  { name: 'suggest_domains_smart', tool: suggestDomainsSmartTool as Tool, schema: suggestDomainsSmartSchema, execute: executeSuggestDomainsSmart as RegisteredTool['execute'] },
  { name: 'tld_info', tool: tldInfoTool as Tool, schema: tldInfoSchema, execute: executeTldInfo as RegisteredTool['execute'] },
  { name: 'check_socials', tool: checkSocialsTool as Tool, schema: checkSocialsSchema, execute: executeCheckSocials as RegisteredTool['execute'] },
  { name: 'analyze_project', tool: analyzeProjectTool as Tool, schema: analyzeProjectSchema, execute: executeAnalyzeProject as RegisteredTool['execute'] },
  { name: 'hunt_domains', tool: huntDomainsTool as Tool, schema: huntDomainsSchema, execute: executeHuntDomains as RegisteredTool['execute'] },
];

const TOOL_MAP = new Map(REGISTERED_TOOLS.map((definition) => [definition.name, definition]));

export function listRegisteredToolSchemas(): Tool[] {
  return REGISTERED_TOOLS.map((definition) => definition.tool);
}

export function getRegisteredTool(
  name: string,
): RegisteredTool | undefined {
  return TOOL_MAP.get(name);
}

export async function executeRegisteredTool(
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const definition = getRegisteredTool(name);

  if (!definition) {
    throw new DomainSearchError(
      'UNKNOWN_TOOL',
      `Unknown tool: ${name}`,
      `The tool "${name}" is not available.`,
      {
        retryable: false,
        suggestedAction: `Available tools: ${REGISTERED_TOOLS.map((tool) => tool.name).join(', ')}`,
      },
    );
  }

  return definition.execute(args);
}
