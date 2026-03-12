import { formatToolResult } from '../../src/utils/format';
import type { SearchResponse, DomainResult, PurchaseResult } from '../../src/types';

describe('formatToolResult', () => {
  it('renders a compact table with pricing labels and links', () => {
    const result: DomainResult = {
      domain: 'example.com',
      available: true,
      status: 'available',
      premium: false,
      price_first_year: 9.99,
      price_renewal: 12.99,
      currency: 'USD',
      privacy_included: true,
      transfer_price: null,
      registrar: 'porkbun',
      checkout_url: 'https://porkbun.com/checkout/search?q=example.com',
      source: 'pricing_api',
      checked_at: new Date().toISOString(),
      pricing_status: 'ok',
      price_check_url: 'https://porkbun.com/checkout/search?q=example.com',
      aftermarket: {
        type: 'auction',
        price: null,
        currency: null,
        source: 'sedo',
        marketplace: 'Sedo',
        url: 'https://sedo.com/search/?keyword=example.com',
      },
    };

    const payload: SearchResponse = {
      results: [result],
      insights: [],
      next_steps: ['tldbot buy example.com --registrar namecheap'],
      non_verified_domains: ['example.io'],
      from_cache: false,
      duration_ms: 10,
    };

    const text = formatToolResult('search', payload, 'table');

    expect(text).toContain('| Domain | Status | Where |');
    expect(text).toContain('Available');
    expect(text).toContain('porkbun');
    expect(text).toContain('Non-verified: example.io');
    expect(text).toContain('Next commands');
    expect(text).toContain('tldbot buy example.com --registrar namecheap');
    expect(text).not.toContain('Insights:');
  });

  it('renders purchase commands instead of raw urls for available domains', () => {
    const payload: PurchaseResult = {
      domain: 'tldscout.com',
      status: 'available',
      mode: 'registrar_options',
      price_first_year: 12.44,
      price_renewal: 12.99,
      currency: 'USD',
      pricing_status: 'catalog_only',
      options: [
        {
          registrar: 'namecheap',
          checkout_url: 'https://www.namecheap.com/domains/registration/results/?domain=tldscout.com',
          checkout_command: 'tldbot buy tldscout.com --registrar namecheap',
        },
      ],
    };

    const text = formatToolResult('buy', payload, 'table');

    expect(text).toContain('Buy tldscout.com');
    expect(text).toContain('Estimated USD 12.44 (estimated) | Renew USD 12.99 (estimated)');
    expect(text).toContain('tldbot buy tldscout.com --registrar namecheap');
    expect(text).not.toContain('https://www.namecheap.com/');
  });

  it('renders marketplace purchase guidance for for-sale domains', () => {
    const payload: PurchaseResult = {
      domain: 'domscout.com',
      status: 'for_sale',
      mode: 'marketplace',
      marketplace: 'HugeDomains',
      registrar: 'godaddy',
      price_first_year: 10195,
      price_renewal: null,
      currency: 'USD',
      checkout_url: 'https://www.hugedomains.com/domain_profile.cfm?d=domscout.com',
      aftermarket: {
        type: 'aftermarket',
        price: 10195,
        currency: 'USD',
        source: 'hugedomains',
        marketplace: 'HugeDomains',
        url: 'https://www.hugedomains.com/domain_profile.cfm?d=domscout.com',
      },
    };

    const text = formatToolResult('buy', payload, 'table');

    expect(text).toContain('Buy domscout.com from HugeDomains');
    expect(text).toContain('USD 10195.00');
    expect(text).not.toContain('(estimated)');
    expect(text).toContain('https://www.hugedomains.com/domain_profile.cfm?d=domscout.com');
  });
});
