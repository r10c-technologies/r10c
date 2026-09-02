import { Context, Effect, Layer, Ref } from 'effect';

/**
 * What a probe is talking to. Read by `GET /api/$service` to sort the wiring
 * document into stores, brokers and upstreams; readiness ignores it entirely.
 */
export type ProbeKind = 'datastore' | 'broker' | 'upstream';

/**
 * One named readiness fact — "can this service still reach Mongo?".
 *
 * `check` is fully applied: whoever registers the probe has already closed over
 * the client handle, so the readiness route can run every probe without knowing
 * what any of them talk to. It must not fail — a probe that cannot answer
 * answers `false`; an unhandled defect in a probe would take down the very
 * endpoint that is supposed to report trouble.
 */
export interface HealthProbe {
  readonly name: string;
  /**
   * What sort of thing is on the other end. `datastore` is a Store's backing
   * engine, `broker` an exchange, `upstream` another service.
   */
  readonly kind: ProbeKind;
  /**
   * The **logical** names this probe covers — a Store's register name
   * (`catalog`, `saga`), an exchange (`entifix.events`), a service (`zitadel`).
   * Never a URI, never a database name: `catalog` is physically
   * `tenant_<organizationId>`, and a document naming those is an organization
   * enumerator (ADR 0031).
   *
   * It is a list rather than one string because a single connection can back
   * several Stores: marketplace-admin-service opens one Mongo client for the
   * `catalog` store and the co-deployed `transaction` slice's `saga` store.
   * Registering one probe per Store instead would put both names into the
   * readiness response's `failing` array, which must not change.
   *
   * The client package that opens the connection cannot know a Store's register
   * name, so the composition root passes it in — the one thing about a probe
   * that is not derivable from the client.
   */
  readonly targets: readonly string[];
  readonly check: Effect.Effect<boolean>;
}

/** The outcome of running every registered probe. */
export interface HealthReport {
  readonly ready: boolean;
  /** Names of the probes that answered `false`, in registration order. */
  readonly failing: readonly string[];
}

/**
 * How long a single probe may take before it counts as failing.
 *
 * This is not belt-and-braces. A driver that queues commands while its
 * connection is down (ioredis with `maxRetriesPerRequest`, for one) leaves the
 * probe pending instead of rejecting, so without a deadline `/api/health/ready`
 * *hangs* when a datastore disappears — the one moment it has to answer. A
 * probe that cannot answer in time is not ready, by definition.
 */
const PROBE_TIMEOUT = '2 seconds';

export interface HealthRegistry {
  /** Add a probe. Called by an infrastructure layer as it constructs a client. */
  readonly register: (probe: HealthProbe) => Effect.Effect<void>;
  /** Run every probe and summarise. Never fails. */
  readonly report: Effect.Effect<HealthReport>;
  /**
   * The registrations themselves, in registration order — what each probe is
   * for, without running any of them.
   *
   * This is what makes the wiring document and readiness generate from **one**
   * registration rather than from two lists that drift. Deliberately separate
   * from {@link report}: describing a service must never cost a round trip to
   * every datastore it has.
   */
  readonly probes: Effect.Effect<readonly HealthProbe[]>;
}

/**
 * DI tag for the readiness registry.
 *
 * The point of a registry rather than a hand-written list per service: a
 * `-service` that gains a datastore gains its readiness probe by merging that
 * client's probe layer, and nothing in the service's own code has to remember
 * to describe it. A list in `main.ts` drifts the first time someone adds a
 * dependency; this cannot, because the probe ships with the client.
 *
 * It lives here, in the contract layer, so `entifix-ts-*-client` packages can
 * register into it without depending on a shell.
 */
export class HealthRegistryTag extends Context.Tag('HealthRegistryTag')<
  HealthRegistryTag,
  HealthRegistry
>() {}

/**
 * Live registry over a `Ref`. Provide it **once** per service and share the
 * instance (`Layer.provideMerge`), or the probes register into a registry the
 * readiness route never reads.
 */
export const HealthRegistryLayer: Layer.Layer<HealthRegistryTag> = Layer.effect(
  HealthRegistryTag,
  Effect.gen(function* () {
    const probes = yield* Ref.make<readonly HealthProbe[]>([]);

    return {
      register: probe => Ref.update(probes, current => [...current, probe]),

      probes: Ref.get(probes),

      report: Effect.gen(function* () {
        const current = yield* Ref.get(probes);
        const results = yield* Effect.forEach(
          current,
          probe =>
            probe.check.pipe(
              // A probe that throws is a failing probe, not a broken endpoint.
              Effect.catchAllDefect(() => Effect.succeed(false)),
              Effect.timeoutTo({
                duration: PROBE_TIMEOUT,
                onTimeout: () => false,
                onSuccess: (ok: boolean) => ok,
              }),
              Effect.map(ok => ({ name: probe.name, ok })),
            ),
          { concurrency: 'unbounded' },
        );
        const failing = results.filter(r => !r.ok).map(r => r.name);
        return { ready: failing.length === 0, failing };
      }),
    };
  }),
);
