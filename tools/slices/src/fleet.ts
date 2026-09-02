/**
 * Where each running deployment answers, and how a declared event pattern is
 * compared to an observed event name.
 *
 * It lives beside the register rather than inside `tools/fleet-map.mjs` for one
 * reason: an address is not something a `SliceDeclaration` carries, so this is a
 * second place a deployment is named — and `slices.spec.ts` therefore checks it.
 * A slice promoted to `active` whose process is missing here would simply never
 * be walked, and the declared-vs-observed diff would pass by asking nobody
 * anything (ADR 0031).
 */

/** One deployment and the port it binds (`docs/_shared/ports.md`). */
export interface FleetEntry {
  /** The Nx project name, matching a slice's `deployments` entry. */
  readonly project: string;
  /** Frontends bind `300N`, backends `310N`, platform services `319x`. */
  readonly port: number;
}

export const FLEET: readonly FleetEntry[] = [
  { project: 'marketplace-service', port: 3100 },
  { project: 'marketplace-admin-service', port: 3101 },
  { project: 'auth-service', port: 3102 },
  { project: 'config-service', port: 3190 },
];

/**
 * Whether an event name matches an AMQP topic pattern: `*` is exactly one
 * segment, `#` is zero or more — the broker's own rule.
 *
 * The diff needs it because the two sides are not the same kind of string. A
 * declaration carries `transaction.*` while what a process emits is
 * `transaction.completed`, so comparing them directly would report every
 * wildcard publisher as undeclared and the check would be noise from its first
 * run.
 */
export const matchesPattern = (pattern: string, name: string): boolean => {
  const expression = pattern
    .split('.')
    .map(segment =>
      segment === '*'
        ? '[^.]+'
        : segment === '#'
          ? '.*'
          : segment.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`),
    )
    .join(String.raw`\.`);
  return new RegExp(`^${expression}$`).test(name);
};
