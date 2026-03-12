import { config } from '../config.js';
import type { CheckoutRegistrar } from '../types.js';

const SUPPORTED_CHECKOUT_REGISTRARS: CheckoutRegistrar[] = [
  'namecheap',
  'cloudflare',
  'godaddy',
];

export function isCheckoutRegistrar(
  value: string | undefined,
): value is CheckoutRegistrar {
  return SUPPORTED_CHECKOUT_REGISTRARS.includes(
    (value || '').toLowerCase() as CheckoutRegistrar,
  );
}

export function pickCheckoutRegistrar(
  preferred?: string | null,
): CheckoutRegistrar {
  if (preferred && isCheckoutRegistrar(preferred)) {
    return preferred.toLowerCase() as CheckoutRegistrar;
  }

  if (isCheckoutRegistrar(config.checkout.defaultRegistrar)) {
    return config.checkout.defaultRegistrar;
  }

  return 'namecheap';
}

export function buildCheckoutUrl(
  domain: string,
  registrar?: string | null,
): { registrar: CheckoutRegistrar; checkout_url: string } {
  const selectedRegistrar = pickCheckoutRegistrar(registrar);
  const encodedDomain = encodeURIComponent(domain);

  switch (selectedRegistrar) {
    case 'cloudflare':
      return {
        registrar: selectedRegistrar,
        checkout_url: `https://domains.cloudflare.com/?domain=${encodedDomain}`,
      };

    case 'godaddy':
      return {
        registrar: selectedRegistrar,
        checkout_url: `https://www.godaddy.com/domainsearch/find?checkAvail=1&domainToCheck=${encodedDomain}`,
      };

    case 'namecheap':
    default: {
      return {
        registrar: 'namecheap',
        checkout_url: `https://www.namecheap.com/domains/registration/results/?domain=${encodedDomain}`,
      };
    }
  }
}

export function buildPreferredCheckoutLinks(
  domain: string,
): Array<{ registrar: CheckoutRegistrar; checkout_url: string }> {
  return ['namecheap', 'godaddy', 'cloudflare'].map((registrar) =>
    buildCheckoutUrl(domain, registrar),
  );
}
