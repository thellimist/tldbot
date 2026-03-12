import type { CheckoutRegistrar, PurchaseResult } from '../types.js';
import { compareRegistrars } from './domain-search.js';
import { buildCheckoutUrl, buildPreferredCheckoutLinks } from './checkout.js';
import { parseDomain } from '../utils/validators.js';
import { CLI_COMMAND } from '../utils/cli-command.js';

function getMarketplaceCheckoutCommand(
  domain: string,
  marketplace: string | undefined,
): string | undefined {
  const normalized = (marketplace || '').toLowerCase();

  if (normalized === 'godaddy' || normalized === 'afternic') {
    return `${CLI_COMMAND} --buy ${domain} --registrar godaddy`;
  }

  return undefined;
}

export async function resolvePurchase(
  domain: string,
  registrar?: CheckoutRegistrar,
): Promise<PurchaseResult> {
  const parsed = parseDomain(domain);
  const fullDomain = `${parsed.name}.${parsed.tld}`;
  const comparison = await compareRegistrars(parsed.name, parsed.tld);
  const marketplaceListing = comparison.comparisons.find(
    (entry) => entry.status === 'for_sale' && entry.aftermarket?.url,
  );

  if (marketplaceListing) {
    const marketplace =
      marketplaceListing.marketplace ||
      marketplaceListing.aftermarket?.marketplace ||
      marketplaceListing.registrar;

    return {
      domain: fullDomain,
      status: 'for_sale',
      mode: 'marketplace',
      marketplace,
      registrar: marketplaceListing.registrar,
      price_first_year: marketplaceListing.price_first_year,
      price_renewal: marketplaceListing.price_renewal,
      currency: marketplaceListing.currency,
      pricing_status: marketplaceListing.pricing_status,
      checkout_url: marketplaceListing.aftermarket?.url,
      checkout_command: getMarketplaceCheckoutCommand(fullDomain, marketplace),
      aftermarket: marketplaceListing.aftermarket,
    };
  }

  const sharedEstimateEntry = comparison.comparisons.find(
    (entry) => entry.status === 'available' && entry.pricing_status === 'catalog_only',
  );

  if (registrar) {
    const purchaseLink = buildCheckoutUrl(fullDomain, registrar);
    const pricedEntry =
      comparison.comparisons.find((entry) => entry.registrar === purchaseLink.registrar) ||
      sharedEstimateEntry;

    return {
      domain: fullDomain,
      status: 'available',
      mode: 'registrar_options',
      registrar: purchaseLink.registrar,
      price_first_year: pricedEntry?.price_first_year ?? null,
      price_renewal: pricedEntry?.price_renewal ?? null,
      currency: pricedEntry?.currency || 'USD',
      pricing_status: pricedEntry?.pricing_status,
      checkout_url: purchaseLink.checkout_url,
      checkout_command: `${CLI_COMMAND} --buy ${fullDomain} --registrar ${purchaseLink.registrar}`,
    };
  }

  const options = buildPreferredCheckoutLinks(fullDomain).map((link) => ({
    registrar: link.registrar,
    checkout_url: link.checkout_url,
    checkout_command: `${CLI_COMMAND} --buy ${fullDomain} --registrar ${link.registrar}`,
  }));

  return {
    domain: fullDomain,
    status: 'available',
    mode: 'registrar_options',
    price_first_year: sharedEstimateEntry?.price_first_year ?? null,
    price_renewal: sharedEstimateEntry?.price_renewal ?? null,
    currency: sharedEstimateEntry?.currency || 'USD',
    pricing_status: sharedEstimateEntry?.pricing_status,
    options,
  };
}
