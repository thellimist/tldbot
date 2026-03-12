import {
  extractAfternicPrice,
  extractHugeDomainsPrice,
} from '../../src/aftermarket/nameservers';

describe('aftermarket price extraction', () => {
  it('extracts HugeDomains listing prices', () => {
    const html = `
      <span>Buy now:</span><span class="big-text green">$10,195</span>
    `;

    expect(extractHugeDomainsPrice(html)).toBe(10195);
  });

  it('extracts Afternic buy-now prices', () => {
    const html = `
      {"buyNowPrice":3600,"buyNowPriceDisplay":"$3,600.00","minPrice":1150}
    `;

    expect(extractAfternicPrice(html)).toBe(3600);
  });
});
