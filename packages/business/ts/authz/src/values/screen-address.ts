import type { ScreenType } from './screen-type.js';

/**
 * Where a screen lives, as data — a {@link ScreenType}, the entity or screen key
 * within it, and optionally the record being viewed.
 *
 * This is the parsed form of a workspace tab address
 * ([ADR 0042](../../../../../../docs/adr/0042-the-workspace-address-is-the-taxonomy-serialized.md)).
 */
export interface ScreenAddress {
  readonly type: ScreenType;
  /** The entity key (`@entity({ key })`) or, for a hand-built screen, its own. */
  readonly key: string;
  /**
   * The position **within** the screen, and what that is depends on the type:
   * a record for `master` (absent for the list of them), a step for `wizard`
   * (absent for its first step).
   *
   * One segment for both, rather than a member per type, because the grammar is
   * what a `TabKind.match` parses and a second optional segment would make every
   * kind's parser handle a shape no kind produces
   * ([ADR 0045](../../../../../../docs/adr/0045-the-wizard-a-step-graph-and-a-submit-that-hands-off.md)).
   */
  readonly id?: string;
}

/**
 * Serialize a {@link ScreenAddress} — `<type>:<key>` for a list, and
 * `<type>:<key>:<id>` for one record.
 *
 * The address is the taxonomy serialized, which is why this lives beside
 * {@link ScreenType} rather than in the workspace that consumes it: it was three
 * grammars (`catalog:` for a list, `entity:` for a record, `system:` for a
 * hand-built screen) spelled out at five call sites that had to agree with each
 * other by hand. Two of those were the same string built twice — the tab address
 * and the autosaved draft's key — so a drift between them silently detached a
 * tab from its own draft.
 *
 * There is no address for a section carrying no {@link ScreenType}. That is not
 * an omission: the account surface is deliberately outside the taxonomy
 * (ADR 0033), and taking a `ScreenType` here is what makes "the account cannot
 * be a tab" a fact the compiler enforces rather than a rule somebody remembers.
 */
export function screenAddress({ type, key, id }: ScreenAddress): string {
  return id === undefined ? `${type}:${key}` : `${type}:${key}:${id}`;
}

/**
 * The inverse of everything {@link screenAddress} writes after `<type>:` — which
 * is exactly what a `TabKind.match` receives, because the registry has already
 * split the kind off the front.
 *
 * Returns `null` rather than a partial result for anything malformed, so a
 * caller cannot accidentally treat an empty key or an empty id as present. A
 * `'brand:'` that parsed as `{ key: 'brand', id: '' }` would resolve to the
 * record editor for a record with no id.
 */
export function parseScreenPayload(
  payload: string,
): { key: string; id?: string } | null {
  const separator = payload.indexOf(':');
  if (separator === -1) {
    return payload === '' ? null : { key: payload };
  }
  const key = payload.slice(0, separator);
  const id = payload.slice(separator + 1);
  return key === '' || id === '' ? null : { key, id };
}
