import { z } from 'zod';
import { isCheckoutRegistrar } from '../services/checkout.js';
import { resolvePurchase } from '../services/purchase.js';
import { wrapError } from '../utils/errors.js';
import type { PurchaseResult } from '../types.js';

export const purchaseDomainSchema = z.object({
  domain: z
    .string()
    .min(3)
    .describe('Full domain to purchase, including TLD (for example, "example.com").'),
  registrar: z
    .enum(['namecheap', 'porkbun', 'cloudflare', 'godaddy'])
    .optional()
    .describe('Optional registrar override. Defaults to the configured checkout registrar.'),
});

export type PurchaseDomainInput = z.infer<typeof purchaseDomainSchema>;

export const purchaseDomainTool = {
  name: 'buy',
  description: `Resolve the next buy action for a domain.

Supported registrars:
- namecheap
- porkbun
- cloudflare
- godaddy`,
  inputSchema: {
    type: 'object',
    properties: {
      domain: {
        type: 'string',
        description: 'Full domain to purchase, including TLD.',
      },
      registrar: {
        type: 'string',
        enum: ['namecheap', 'porkbun', 'cloudflare', 'godaddy'],
        description: 'Optional registrar override.',
      },
    },
    required: ['domain'],
  },
};

export async function executePurchaseDomain(
  input: PurchaseDomainInput,
): Promise<PurchaseResult> {
  try {
    const { domain, registrar } = purchaseDomainSchema.parse(input);
    return await resolvePurchase(
      domain,
      isCheckoutRegistrar(registrar) ? registrar : undefined,
    );
  } catch (error) {
    throw wrapError(error);
  }
}
