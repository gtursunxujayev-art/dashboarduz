import type { Server } from 'http';
import type { AddressInfo } from 'net';

import express from 'express';

import { Metrics } from '../../services/observability';
import * as redisClient from '../../services/queue/redis-client';
import { applyObservabilityMiddleware } from '../observability';

const app = express();

applyObservabilityMiddleware(app);
app.get('/ping', (req, res) => {
  res.json({ requestId: req.context.requestId, userId: req.context.userId ?? null });
});
app.get('/missing', (_req, res) => {
  res.status(404).send('nope');
});

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  Metrics.reset();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('applyObservabilityMiddleware', () => {
  it('keeps an incoming x-request-id and echoes it', async () => {
    const response = await fetch(`${baseUrl}/ping`, { headers: { 'x-request-id': 'req-123' } });

    expect(response.headers.get('x-request-id')).toBe('req-123');
    expect(await response.json()).toEqual({ requestId: 'req-123', userId: null });
  });

  it('generates a request id when none is sent', async () => {
    const response = await fetch(`${baseUrl}/ping`);
    const requestId = response.headers.get('x-request-id');

    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await response.json()).toEqual({ requestId, userId: null });
  });

  it('counts requests by method, path and status class', async () => {
    await fetch(`${baseUrl}/ping`);
    await fetch(`${baseUrl}/missing`);

    const { counters, histograms } = Metrics.toJSON();

    expect(counters['http_requests_total{method="GET",path="/ping",status="2xx"}']).toBe(1);
    expect(counters['http_requests_total{method="GET",path="/missing",status="4xx"}']).toBe(1);
    expect(histograms['http_request_duration_ms{method="GET",path="/ping"}']?.count).toBe(1);
  });

  it('serves the metrics in Prometheus text format on /metrics', async () => {
    Metrics.increment('jobs_total', { queue: 'webhooks' }, 2);

    const response = await fetch(`${baseUrl}/metrics`);
    const text = await response.text();

    // res.send adds the charset to the Content-Type the middleware sets.
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8; version=0.0.4');
    expect(text).toContain('# TYPE jobs_total counter');
    expect(text).toMatch(/^jobs_total\{queue="webhooks"\} 2 \d+$/m);
  });

  it('reports redis health and metric counts on /health/detailed', async () => {
    jest.spyOn(redisClient, 'checkRedisHealth').mockResolvedValue({ status: 'healthy', latency: 3 });
    Metrics.setGauge('queue_depth', 4);

    const response = await fetch(`${baseUrl}/health/detailed`);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toEqual(expect.objectContaining({
      status: 'healthy',
      services: { redis: { status: 'healthy', latency: 3 } },
      // The "Request started" log already counted this request (operation_count).
      metrics: { counters: 1, gauges: 1, histograms: 0 },
    }));
  });

  it('answers 503 on /health/detailed when the redis check throws', async () => {
    jest.spyOn(redisClient, 'checkRedisHealth').mockRejectedValue(new Error('no redis'));

    const response = await fetch(`${baseUrl}/health/detailed`);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: 'unhealthy', timestamp: expect.any(String), error: 'no redis' });
  });
});
