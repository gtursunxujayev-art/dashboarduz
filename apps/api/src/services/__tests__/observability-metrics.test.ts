import { logger } from '../../lib/logger';
import { LogLevel, logWithContext, Metrics, reportError } from '../observability';

beforeEach(() => {
  Metrics.reset();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('Metrics', () => {
  it('accumulates counters, gauges and histograms per label set', () => {
    Metrics.increment('hits');
    Metrics.increment('hits', undefined, 2);
    Metrics.increment('hits', { path: '/a', method: 'GET' });
    Metrics.setGauge('depth', 5);
    Metrics.setGauge('depth', 7);
    Metrics.recordHistogram('latency', 100, { op: 'x' });
    Metrics.recordHistogram('latency', 300, { op: 'x' });

    expect(Metrics.toJSON()).toEqual({
      counters: { hits: 3, 'hits{path="/a",method="GET"}': 1 },
      gauges: { depth: 7 },
      histograms: { 'latency{op="x"}': { sum: 400, count: 2, values: [100, 300] } },
      timestamp: expect.any(String),
    });
  });

  it('exports Prometheus text with cumulative histogram buckets in seconds', () => {
    jest.spyOn(Date, 'now').mockReturnValue(1000);
    Metrics.increment('hits', { a: '1' });
    Metrics.setGauge('depth', 2);
    Metrics.recordHistogram('latency', 200, { op: 'x' });
    Metrics.recordHistogram('latency', 2000, { op: 'x' });

    expect(Metrics.export().split('\n')).toEqual([
      '# TYPE hits counter',
      'hits{a="1"} 1 1000',
      '# TYPE depth gauge',
      'depth 2 1000',
      '# TYPE latency histogram',
      'latency_sum{op="x"} 2200 1000',
      'latency_count{op="x"} 2 1000',
      'latency_bucket{op="x",le="0.1"} 0 1000',
      'latency_bucket{op="x",le="0.5"} 1 1000',
      'latency_bucket{op="x",le="1"} 1 1000',
      'latency_bucket{op="x",le="5"} 2 1000',
      'latency_bucket{op="x",le="10"} 2 1000',
      'latency_bucket{op="x",le="30"} 2 1000',
      'latency_bucket{op="x",le="60"} 2 1000',
      'latency_bucket{op="x",le="300"} 2 1000',
      // Known bug (services/observability.ts, +Inf line): replace('}', ',le="+Inf"') drops the closing brace.
      'latency_bucket{op="x",le="+Inf" 2 1000',
    ]);
  });

  it.todo('closes the label set of the +Inf histogram bucket (currently `le="+Inf"` without `}`)');
});

describe('logWithContext', () => {
  it('logs at the level and records duration and operation metrics', () => {
    const info = jest.spyOn(logger, 'info').mockImplementation(() => undefined);

    logWithContext(LogLevel.INFO, 'done', { operation: 'sync', duration: 12, tenantId: 't-1' });

    expect(info).toHaveBeenCalledWith({ operation: 'sync', duration: 12, tenantId: 't-1', duration_ms: 12 }, 'done');
    expect(Metrics.toJSON()).toEqual(expect.objectContaining({
      counters: { 'operation_count{operation="sync",level="info",tenant_id="t-1"}': 1 },
      histograms: { 'operation_duration{operation="sync",tenant_id="t-1"}': { sum: 12, count: 1, values: [12] } },
    }));
  });

  it('routes errors through reportError (logger.error without a Sentry DSN)', () => {
    const error = jest.spyOn(logger, 'error').mockImplementation(() => undefined);

    logWithContext(LogLevel.ERROR, 'failed', { requestId: 'r-1' });
    reportError('direct', { tenantId: 't-2' });

    expect(error).toHaveBeenNthCalledWith(1, { requestId: 'r-1' }, 'failed');
    expect(error).toHaveBeenNthCalledWith(2, { tenantId: 't-2' }, 'direct');
  });
});
