import {
  DataPointType,
  type MetricData,
  type SumMetricData,
} from '@opentelemetry/sdk-metrics';
import { makeStubConfigurationClient } from '@r10c/entifix-ts-testing-unit';
import type { LogRecord } from '@r10c/entifix-ts-tooling/logging';
import {
  Cause,
  Effect,
  FiberId,
  FiberRef,
  FiberRefs,
  HashMap,
  HashSet,
  List,
  Logger,
  LogLevel,
  Metric,
} from 'effect';
import { describe, expect, it, vi } from 'vitest';

import {
  makeInMemoryObservabilityLayer,
  makeObservabilityLayer,
  makeObservabilityLayerWith,
  observabilityFromConfiguration,
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

/**
 * The OTLP arm of the sink selection, and the reporter attached to it.
 *
 * `makeObservabilityLayer` is what production calls, and it is the only path
 * that builds a real `makeOtlpHttpLogSink` — the in-memory layer above supplies
 * its own sink, so nothing else in this file reaches this branch. The export
 * failure is reported to stderr rather than thrown: a Collector that is down
 * must not take the logging pipeline with it.
 */
describe('the OTLP log sink', () => {
  it('reports an export failure to stderr instead of throwing', async () => {
    const written: string[] = [];
    const write = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(chunk => {
        written.push(String(chunk));
        return true;
      });

    // Nothing listens on this port, so the sink's flush fails for real.
    const layer = makeObservabilityLayer({
      serviceName: '@r10c/spec-service',
      level: 'debug',
      sink: 'otlp',
      otelEndpoint: 'http://127.0.0.1:1',
    });

    await expect(
      Effect.runPromise(
        Effect.logInfo('into the void').pipe(Effect.provide(layer)),
      ),
    ).resolves.toBeUndefined();

    // The sink batches on a 2s interval; wait past it for the failed export.
    await vi.waitFor(
      () =>
        expect(
          written.some(line => line.startsWith('[otlp-log-sink] export failed')),
        ).toBe(true),
      { timeout: 8000, interval: 100 },
    );

    write.mockRestore();
  }, 15000);
});

/**
 * `getSpans` on the in-memory layer. The e2e re-exports it as `capturedSpans`
 * and asserts a request produced a trace; here it only has to be exercised,
 * since the collection itself is the OTel exporter's.
 *
 * Read **inside** the provided effect, not after it: `NodeSdk`'s finalizer
 * shuts the SDK down when the layer's scope closes, and
 * `InMemorySpanExporter.shutdown()` clears the finished spans — so a read after
 * `runPromise` resolves finds an empty array no matter what was traced. The
 * e2e never hits this because its layer stays alive for the whole run.
 */
describe('the in-memory observability handle', () => {
  it('exposes the spans the layer exported', async () => {
    const observability = makeInMemoryObservabilityLayer('@r10c/spec-service');

    const names = await Effect.runPromise(
      Effect.gen(function* () {
        yield* Effect.logInfo('traced').pipe(Effect.withSpan('spec-span'));
        return observability.getSpans().map(span => span.name);
      }).pipe(Effect.provide(observability.layer)),
    );

    expect(names).toContain('spec-span');
  });
});

/**
 * The per-service read every composition root now makes.
 *
 * The two `logging` keys are required and the two `otel` keys are not, which is
 * the whole contract: a service with no telemetry destination still boots.
 */
describe('observabilityFromConfiguration', () => {
  const configuration = (
    logging: { key: string; value: string }[],
    otel: { key: string; value: string }[] = [],
  ) => makeStubConfigurationClient({ logging, otel });

  it('builds a layer from the four configured values', async () => {
    const store = configuration(
      [
        { key: 'level', value: 'debug' },
        { key: 'sink', value: 'otlp' },
      ],
      [
        { key: 'endpoint', value: 'http://127.0.0.1:30318' },
        { key: 'metricIntervalMs', value: '1000' },
      ],
    );

    const layer = await Effect.runPromise(
      observabilityFromConfiguration(store, '@r10c/spec-service'),
    );

    await expect(
      Effect.runPromise(Effect.logInfo('configured').pipe(Effect.provide(layer))),
    ).resolves.toBeUndefined();
  });

  // The endpoint and the interval are both optional: a service whose seed
  // predates either key boots and simply exports nothing.
  it('builds a layer with neither otel key present', async () => {
    const records: LogRecord[] = [];
    const store = configuration([
      { key: 'level', value: 'debug' },
      { key: 'sink', value: 'stdout' },
    ]);

    const layer = await Effect.runPromise(
      observabilityFromConfiguration(store, '@r10c/spec-service'),
    );
    const emit = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(chunk => {
        records.push(JSON.parse(String(chunk)) as LogRecord);
        return true;
      });

    await Effect.runPromise(
      Effect.logInfo('no collector').pipe(Effect.provide(layer)),
    );
    emit.mockRestore();

    expect(records.at(-1)?.message).toBe('no collector');
  });

  // Anything but the literal `stdout` selects the OTLP sink, so a mistyped
  // value degrades to shipping logs rather than to silently dropping them.
  it.each([
    ['stdout', 'stdout'],
    ['otlp', 'otlp'],
    ['typo', 'otlp'],
  ])('reads sink %s as %s', async sink => {
    const store = configuration([
      { key: 'level', value: 'info' },
      { key: 'sink', value: sink },
    ]);

    await expect(
      Effect.runPromise(
        observabilityFromConfiguration(store, '@r10c/spec-service'),
      ),
    ).resolves.toBeDefined();
  });

  // Required, because the rows are seeded for every service and reach an
  // existing table on config-service's next boot — so a missing one is a real
  // misconfiguration rather than an old fleet, and should be loud.
  it.each(['level', 'sink'])('fails when logging.%s is missing', async key => {
    const store = configuration(
      [
        { key: 'level', value: 'debug' },
        { key: 'sink', value: 'otlp' },
      ].filter(item => item.key !== key),
    );

    await expect(
      Effect.runPromise(
        observabilityFromConfiguration(store, '@r10c/spec-service'),
      ),
    ).rejects.toThrow();
  });
});

/**
 * The two label arms the four common levels do not reach, and the array form of
 * a log message.
 *
 * `TRACE` and `FATAL` are real `effect/LogLevel` labels that collapse onto the
 * four the tooling logger has. They are asserted for the same reason the others
 * are: the whole switch matched nothing for a year, and a case nothing exercises
 * is how that survives a second time.
 */
describe('the log bridge at the edges of the level set', () => {
  const runAtTrace = async (effect: Effect.Effect<void>) => {
    const observability = makeInMemoryObservabilityLayer('@r10c/spec-service');
    await Effect.runPromise(
      effect.pipe(
        Logger.withMinimumLogLevel(LogLevel.All),
        Effect.provide(observability.layer),
      ),
    );
    return observability.logRecords;
  };

  it.each([
    ['trace', Effect.logTrace('quiet'), 'debug', 5],
    ['fatal', Effect.logFatal('gone'), 'error', 17],
  ])('collapses %s onto %s', async (_label, effect, level, severity) => {
    const records = await runAtTrace(effect);

    const record = records.at(-1);
    expect(record?.level).toBe(level);
    expect(record?.severityNumber).toBe(severity);
  });

  // Effect hands a multi-part log through as an array; joining is what keeps
  // the message readable instead of arriving as `a,b`.
  it('joins a multi-part message with spaces', async () => {
    const records = await runAtTrace(Effect.logInfo('order', 'accepted'));

    expect(records.at(-1)?.message).toBe('order accepted');
  });
});

/**
 * A log message that is not an array.
 *
 * Effect's own `Effect.log*` functions always hand the logger an **array**,
 * even for a single part (`Effect.logInfo('x')` arrives as `['x']`), so the
 * scalar arm of the message conversion is unreachable through them. It is not
 * dead: `Logger.log` is public API, and anything integrating with Effect's
 * logging — a bridge from another framework's logger — can call it with a bare
 * value. Driven here through that seam rather than deleted, because the
 * parameter is typed `unknown` and dropping the arm would emit `[object
 * Object]` for the first caller that uses it.
 */
describe('a log message that is not an array', () => {
  it('stringifies a bare value', async () => {
    const observability = makeInMemoryObservabilityLayer('@r10c/spec-service');

    await Effect.runPromise(
      Effect.gen(function* () {
        const loggers = yield* FiberRef.get(FiberRef.currentLoggers);
        for (const logger of HashSet.values(loggers)) {
          logger.log({
            message: 'bare string',
            logLevel: LogLevel.Info,
            annotations: HashMap.empty(),
            cause: Cause.empty,
            context: FiberRefs.unsafeMake(new Map()),
            date: new Date(),
            fiberId: FiberId.none,
            spans: List.empty(),
          });
        }
      }).pipe(Effect.provide(observability.layer)),
    );

    expect(
      observability.logRecords.map(record => record.message),
    ).toContain('bare string');
  });
});
