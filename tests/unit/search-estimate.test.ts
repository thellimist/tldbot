import {
  estimateSearchDuration,
  estimateBulkDuration,
  estimateTldDurationMs,
} from '../../src/utils/search-estimate';

describe('search estimate helpers', () => {
  it('assigns slower estimates to heavier TLDs', () => {
    expect(estimateTldDurationMs('so')).toBeGreaterThan(estimateTldDurationMs('com'));
    expect(estimateTldDurationMs('ai')).toBeGreaterThan(estimateTldDurationMs('dev'));
  });

  it('estimates multi-tld searches', () => {
    const estimate = estimateSearchDuration(['com', 'so', 'co'], true, 10);
    expect(estimate.estimated_duration_ms).toBeGreaterThan(0);
    expect(estimate.estimated_duration_label.length).toBeGreaterThan(0);
  });

  it('estimates bulk searches', () => {
    const estimate = estimateBulkDuration(100, 'so', 20, false);
    expect(estimate.estimated_duration_ms).toBeGreaterThanOrEqual(500);
  });
});
