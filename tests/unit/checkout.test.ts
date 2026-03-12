import { buildCheckoutUrl } from '../../src/services/checkout';

describe('buildCheckoutUrl', () => {
  it('builds a default checkout URL', () => {
    const result = buildCheckoutUrl('example.com');

    expect(result.registrar).toBe('namecheap');
    expect(result.checkout_url).toContain('namecheap.com/domains/registration/results/');
    expect(result.checkout_url).toContain('domain=example.com');
  });

  it('supports registrar overrides', () => {
    const result = buildCheckoutUrl('example.dev', 'cloudflare');

    expect(result.registrar).toBe('cloudflare');
    expect(result.checkout_url).toContain('domains.cloudflare.com/?domain=example.dev');
  });

  it('supports godaddy overrides', () => {
    const result = buildCheckoutUrl('example.sh', 'godaddy');

    expect(result.registrar).toBe('godaddy');
    expect(result.checkout_url).toContain('godaddy.com/domainsearch/find');
    expect(result.checkout_url).toContain('domainToCheck=example.sh');
  });
});
