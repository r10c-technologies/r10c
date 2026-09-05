/**
 * The executable form of ADR 0020's vocabulary.
 *
 * `docs/_shared/planes.md` carries the same register in prose for humans; this
 * file is what `slices.spec.ts` checks the repository against. When the two
 * disagree, the tests are the ones that fail a build, so fix the declaration
 * first and mirror it into the doc.
 */

/** Who may read a store. Derived by every entity it hosts (ADR 0020). */
export type Plane = 'control' | 'platform' | 'tenant';

/**
 * Whether a store is the origin of its data or a copy of another store's.
 * `projection-of:<store>` is what makes ADR 0009's published catalog and
 * ADR 0012's reporting copies the same shape rather than two special cases.
 */
export type Truth = 'system-of-record' | `projection-of:${string}`;

/** One database per organization, or one shared by all of them. */
export type Partitioning = 'single' | 'per-organization';

/**
 * A named persistence boundary with exactly one writing slice, one plane, and an
 * identity independent of the engine backing it.
 *
 * There is deliberately no `owner` field: a store is declared *inside* the slice
 * that owns it, so "exactly one writing slice" is structural rather than a
 * string two declarations could both claim.
 *
 * There is also deliberately no `engine`. Mongo/Postgres/Redis are deployment
 * facts — one engine may host many stores, but a store may never span engines.
 */
export interface StoreDeclaration {
  /** Stable logical name. Not the database name: `catalog` is `tenant_<id>`. */
  readonly name: string;
  readonly plane: Plane;
  /**
   * The domains whose entities live here, by their `@entity({ domain })` value.
   * More than one is a **binding**: those domains are permanently co-deployed
   * and cannot be separated without a data migration.
   */
  readonly hosts: readonly string[];
  readonly partitioning: Partitioning;
  readonly truth: Truth;
  /** Why a multi-domain store was accepted. Required when `hosts.length > 1`. */
  readonly bindingReason?: string;
}

/**
 * The unit that owns Stores and the unit of physical split. Holds one or more
 * domains, owns zero or more stores, and is realized as one or more deployments.
 *
 * The API/event fields are borrowed from TM Forum ODA's Component, which is the
 * nearest standard shape to a Slice. ODA names no data-ownership concept, which
 * is why `Store` is ours.
 */
/**
 * Whether a slice runs yet.
 *
 * `planned` records **ownership before a process exists**. That is not a
 * placeholder: the three invariants apply to a planned slice exactly as they do
 * to an active one, so a boundary error is caught when the entities land rather
 * than when someone finally writes the service.
 *
 * What a planned slice must *not* do is claim a deployment. Opening a database
 * handle for a store nothing writes creates a persistence boundary with no
 * contents and no purpose — the defect ADR 0020 named when it struck
 * `marketplace_admin` from the register. So a slice is promoted to `active` by
 * the commit that writes its store, never before.
 */
export type SliceStatus = 'active' | 'planned';

/**
 * How a subscriber's queue is shaped. Mirrors `SubscriptionMode` in
 * `@r10c/entifix-transactions` — the register may not import a package, so the
 * two literal sets are duplicated the way `settlement-management` duplicates
 * `SalesChannelType`, and both are pinned by a spec.
 */
export const SUBSCRIPTION_MODES = ['work', 'broadcast'] as const;

export type SubscriptionMode = (typeof SUBSCRIPTION_MODES)[number];

/**
 * How a consumer survives an at-least-once redelivery.
 *
 * `inbox` claims `event.id` in the same storage transaction as the side effect
 * (`TransactionInbox`); `natural` asserts the handler is idempotent by
 * construction and must say **why**, because that is a property of the code
 * which nothing else checks and which the next edit can quietly remove.
 *
 * Duplicated from `@r10c/entifix-transactions` for the reason
 * {@link SUBSCRIPTION_MODES} is.
 */
export const DEDUPE_STRATEGIES = ['inbox', 'natural'] as const;

export type DedupeStrategy = (typeof DEDUPE_STRATEGIES)[number];

/**
 * One event a slice consumes, together with the delivery policy the broker
 * enforces for it.
 *
 * The register already made store ownership executable; carrying the policy
 * here makes *delivery* executable in the same way, so "how does this fail" is
 * answered where a test can read it rather than in a review comment
 * ([ADR 0030](../../../docs/adr/0030-failure-retry-and-quarantine-on-the-bus.md)).
 *
 * `dedupe` landed with #178, which is what enforces it — it was withheld until
 * then for the reason ADR 0020 struck a phantom store: a declaration nothing
 * reads is the same defect as a store nothing writes.
 */
export interface SubscriptionDeclaration {
  /** The event name or pattern, used verbatim as the AMQP binding. */
  readonly event: string;
  readonly mode: SubscriptionMode;
  /**
   * Deliveries the broker allows before dead-lettering the message. `work`
   * queues carry it as `x-delivery-limit`; a `broadcast` queue has no
   * dead-letter path, so it is declared and unenforced there.
   */
  readonly maxAttempts: number;
  /**
   * How this consumer survives a redelivery. Delivery is at-least-once by
   * construction, so every subscription has an answer; the field exists to stop
   * the next one inheriting an assumption nobody re-checked.
   */
  readonly dedupe: DedupeStrategy;
  /**
   * Why the handler is idempotent by construction. **Required when `dedupe` is
   * `'natural'`** and meaningless otherwise — an `inbox` consumer's mechanism is
   * the claim, and needs no prose.
   */
  readonly dedupeReason?: string;
}

export interface SliceDeclaration {
  readonly name: string;
  /**
   * `active` slices declare at least one deployment; `planned` slices declare
   * none. `slices.spec.ts` enforces both directions.
   */
  readonly status: SliceStatus;
  /** Domains this slice implements, whether or not they own entities. */
  readonly domains: readonly string[];
  readonly stores: readonly StoreDeclaration[];
  /** Nx project names actually running this slice. Empty when `planned`. */
  readonly deployments: readonly string[];
  /**
   * Slices sharing a deployment with this one. Co-deploying is **reversible**
   * (two slices, one process); merging two slices' stores is not. Recording it
   * here is what keeps the difference visible.
   */
  readonly coDeployedWith: readonly string[];
  readonly exposedAPIs: readonly string[];
  readonly dependantAPIs: readonly string[];
  readonly publishedEvents: readonly string[];
  /**
   * What this slice consumes, and how a failed delivery is treated. Replaced
   * `subscribedEvents: readonly string[]`, which said what a consumer wanted
   * and nothing about what happens when it cannot have it.
   */
  readonly subscriptions: readonly SubscriptionDeclaration[];
}
