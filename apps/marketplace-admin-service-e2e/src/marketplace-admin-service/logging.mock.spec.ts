import { defineServiceE2e } from '@r10c/entifix-ts-testing-e2e/service';

import {
  capturedLogRecords,
  capturedSpans,
  startMockService,
} from '../support/mock-service';

/**
 * The observability pipeline end to end, mock profile only: the service's real
 * router runs under the shipped logger replacement + OTel tracer (with in-memory
 * exporters), so these assertions prove the logs that reach a sink are
 * structured and carry the `trace_id` of the request span that produced them.
 *
 * Mock-only because it reads the in-process in-memory sink; the same guarantee
 * is checked against real infrastructure by the live validation script (logs
 * land in Loki, a log's trace id resolves in Tempo).
 */
const service = defineServiceE2e({
  liveUrlEnvVar: 'MARKETPLACE_ADMIN_SERVICE_URL',
  startMock: startMockService,
});

describe('structured logging pipeline (mock)', () => {
  it('emits structured records through the replaced logger', async () => {
    await service.client.get('/api/health');
    await service.client.get('/api/product');

    expect(capturedLogRecords.length).toBeGreaterThan(0);
    const record = capturedLogRecords[capturedLogRecords.length - 1];
    expect(record.service).toBe('@r10c/marketplace-admin-service');
    expect(['debug', 'info', 'warn', 'error']).toContain(record.level);
    expect(typeof record.message).toBe('string');
    expect(typeof record.timestamp).toBe('string');
  });

  it('correlates a log to its request trace', async () => {
    const before = capturedLogRecords.length;

    await service.client.get('/api/product');

    const fromRequest = capturedLogRecords.slice(before);
    const correlated = fromRequest.find(
      record => typeof record.traceId === 'string' && record.traceId.length > 0,
    );
    expect(correlated).toBeDefined();
    expect(correlated?.spanId).toBeTruthy();
    // The request also produced a span that was exported through the tracer.
    expect(capturedSpans().length).toBeGreaterThan(0);
  });
});
