import {
  DataPointType,
  type MetricData,
  type SumMetricData,
} from '@opentelemetry/sdk-metrics';
import type { LogRecord } from '@r10c/entifix-ts-tooling/logging';
import { Effect, Logger, LogLevel, Metric } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  makeInMemoryObservabilityLayer,
  makeObservabilityLayer,
  makeObservabilityLayerWith,
} from './observability.js';

/**
 * The Effect → tooling logger bridge, asserted at the two points where it was
 * silently wrong.
 *
 * The existing e2e (`logging.mock.spec.ts`) checks that records are structured
 * and trace-correlated, and it passed throughout: its level assertion is
 * `expect(['debug','info','warn','error']).toContain(record.level)`, which
 * every record satisfied precisely because every record was `info`. An
 * assertion that admits all four values cannot see a mapper that only ever
 * returns one, so the level is pinned per level here instead.
 */
const runLogging = async <A>(effect: Effect.Effect<A>) => {
  const observability = makeInMemoryObservabilityLayer('@r10c/spec-service');
  await Effect.runPromise(
    effect.pipe(
      // Effect's own minimum is `Info`, so a `logDebug` is dropped before any
      // logger sees it — independent of the tooling logger's `level`, which the
      // in-memory layer already sets to `debug`. Both have to be lowered, and a
      // spec that only set the second would report the bridge as losing a debug
      // record it was never handed.
      Logger.withMinimumLogLevel(LogLevel.Debug),
      Effect.provide(observability.layer),
    ),
  );
  return observability.logRecords;
};

describe('the Effect log bridge', () => {
  // Effect's labels are upper case (`"ERROR"`, `"WARN"`, `"DEBUG"`), and the
  // mapper used to switch on `'Error'`/`'Warning'`/`'Debug'` — no case could
  // match, so everything fell through to `info`. An `Effect.logError` reaching
  // a sink as INFO is invisible to every level-based alert while still being
  // present in the log, which reads as "the service has no errors".
  it.each([
    ['error', Effect.logError('boom'), 17],
    ['warn', Effect.logWarning('careful'), 13],
    ['info', Effect.logInfo('hello'), 9],
    ['debug', Effect.logDebug('noisy'), 5],
  ])(
    'maps %s to its own level and severity',
    async (level, effect, severity) => {
      const records = await runLogging(effect);

      const record = records.at(-1);
      expect(record?.level).toBe(level);
      expect(record?.severityNumber).toBe(severity);
    },
  );

  // `annotations` used to be destructured away and never forwarded, so every
  // `Effect.annotateLogs` in every service was discarded before a sink saw it —
  // including the transaction id on a failed compensation and the tenant
  // database on a quarantined outbox entry.
  it('forwards annotations as structured attributes', async () => {
    const records = await runLogging(
      Effect.logError('transaction rollback failed').pipe(
        Effect.annotateLogs({
          transactionId: 'tx-1',
          entity: 'product-specification',
          attempts: 3,
          quarantined: true,
        }),
      ),
    );

    expect(records.at(-1)?.attributes).toMatchObject({
      transactionId: 'tx-1',
      entity: 'product-specification',
      attempts: 3,
      quarantined: true,
    });
  });

  // The attribute values are a closed scalar set, so a non-scalar annotation is
  // stringified rather than dropped: a field that reads `[object Object]` still
  // tells an operator it was set, where a missing one is indistinguishable from
  // never having been annotated at all.
  it('stringifies an annotation that is not a scalar', async () => {
    const records = await runLogging(
      Effect.logInfo('shaped').pipe(
        Effect.annotateLogs({ where: { deep: true } }),
      ),
    );

    expect(typeof records.at(-1)?.attributes.where).toBe('string');
  });

  it('keeps a log with no annotations free of extra attributes', async () => {
    const records = await runLogging(Effect.logInfo('bare'));

    expect(records.at(-1)?.attributes).toEqual({});
  });
});

/**
 * The metric half of the same wiring. Until #185 `NodeSdk` was built with an
 * `OTLPTraceExporter` and nothing else — no `MeterProvider`, no metric reader —
 * so a service could call `Metric.*` and the value went nowhere while logs and
 * traces reached the Collector. That is a failure with no symptom at the call
 * site: the counter increments, the program is correct, and the dashboard is
 * simply empty.
 *
 * These assert against the real composition rather than a double, because the
 * thing that can break is the composition: `NodeSdk` only registers a
 * `MetricProducer` when it is handed a reader, and the producer is what reads
 * Effect's own metric registry.
 */
/**
 * A counter has to arrive as a `Sum`, and `MetricData` is a union whose
 * `dataPoints` differ per arm — so this narrows rather than casting. Asserting
 * the arm is part of the point: an Effect counter exported as a gauge or a
 * histogram would still have a value and would still be wrong.
 */
const isSum = (metric: MetricData): metric is SumMetricData =>
  metric.dataPointType === DataPointType.SUM;

describe('the metric pipeline', () => {
  it('exports a counter incremented inside the layer', async () => {
    const observability = makeInMemoryObservabilityLayer('@r10c/spec-service');
    const requests = Metric.counter('spec_requests_total', {
      description: 'requests handled, for the pipeline spec',
    });

    await Effect.runPromise(
      Metric.increment(requests).pipe(
        Effect.andThen(Metric.increment(requests)),
        Effect.provide(observability.layer),
      ),
    );

    const collected = await observability.collectMetrics();
    const counter = collected
      .flatMap(resourceMetrics => resourceMetrics.scopeMetrics)
      .flatMap(scope => scope.metrics)
      .filter(metric => metric.descriptor.name === 'spec_requests_total')
      .find(isSum);

    expect(counter?.dataPoints.at(-1)?.value).toBe(2);
  });

  // The resource is built once by `NodeSdk` and shared by both signals, so a
  // metric arriving under a different `service.name` than its spans would make
  // every dashboard that joins the two silently empty.
  it('stamps the metrics with the service name', async () => {
    const observability = makeInMemoryObservabilityLayer('@r10c/spec-service');
    const errors = Metric.counter('spec_errors_total');

    await Effect.runPromise(
      Metric.increment(errors).pipe(Effect.provide(observability.layer)),
    );

    const collected = await observability.collectMetrics();

    expect(collected.at(-1)?.resource.attributes['service.name']).toBe(
      '@r10c/spec-service',
    );
  });
});

/**
 * The boot guarantee. `otel.endpoint` used to be a required `getString`, so a
 * service whose configuration lacked it failed to start at all — telemetry
 * being unreachable took the service down with it, which is the wrong trade for
 * a signal that is not on the request path. With no endpoint the layer builds,
 * runs, and logs; it simply exports nothing.
 */
describe('an observability layer with no OTLP endpoint', () => {
  // A blank endpoint is what config-service's operator CRUD writes, so it is
  // reachable without editing a seed. Taken literally it would aim the
  // exporters at the relative `/v1/traces` and `/v1/metrics` — a service that
  // exports nothing while looking configured.
  it.each([undefined, '', '   '])(
    'treats %o as no destination and still boots',
    async endpoint => {
      const layer = makeObservabilityLayer({
        serviceName: '@r10c/spec-service',
        level: 'debug',
        sink: 'otlp',
        otelEndpoint: endpoint,
      });

      await expect(
        Effect.runPromise(Effect.logInfo('booted').pipe(Effect.provide(layer))),
      ).resolves.toBeUndefined();
    },
  );

  it('builds, runs and still logs', async () => {
    const records: LogRecord[] = [];
    const layer = makeObservabilityLayerWith({
      serviceName: '@r10c/spec-service',
      level: 'debug',
      sink: { emit: record => records.push(record) },
    });

    await Effect.runPromise(
      Effect.logInfo('booted without a collector').pipe(Effect.provide(layer)),
    );

    expect(records.at(-1)?.message).toBe('booted without a collector');
  });
});
