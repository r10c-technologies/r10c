import type { ReactNode } from 'react';

/**
 * One kind of tab (a catalog, an entity editor, later an operation or wizard).
 * A page is addressed by the `?tab=` value `"<kind>:<payload>"`; the kind owns
 * the payload half — parsing it to an address, serializing it back, and
 * rendering it. Registering a kind is the only change adding a new tab type
 * needs; the router and store never change.
 */
export interface TabKind<TAddr = unknown> {
  /** The leading segment of the `?tab=` value, e.g. `catalog`, `entity`. */
  kind: string;
  /** Parse the part after `<kind>:` into an address, or `null` if invalid. */
  match(payload: string): TAddr | null;
  /** Serialize an address back to the payload (without the `<kind>:` prefix). */
  toParam(addr: TAddr): string;
  title(addr: TAddr): string;
  render(addr: TAddr): ReactNode;
}

/** A resolved tab: everything the strip and body need, addressed by `param`. */
export interface ResolvedTab {
  /** The canonical `?tab=` value — the tab's identity and deep link. */
  param: string;
  title: string;
  render: () => ReactNode;
}

/** Split a `?tab=` value into its kind and payload halves. */
export function splitParam(param: string): { kind: string; payload: string } {
  const separator = param.indexOf(':');
  return separator === -1
    ? { kind: param, payload: '' }
    : { kind: param.slice(0, separator), payload: param.slice(separator + 1) };
}

/**
 * The registry of tab kinds. `resolve` turns a `?tab=` value into a renderable
 * tab, or `null` when the kind is unknown or the payload is invalid — the
 * caller shows a fallback rather than crashing the workspace.
 */
export class TabRegistry {
  readonly #kinds = new Map<string, TabKind<unknown>>();

  register<TAddr>(kind: TabKind<TAddr>): this {
    this.#kinds.set(kind.kind, kind as TabKind<unknown>);
    return this;
  }

  has(kind: string): boolean {
    return this.#kinds.has(kind);
  }

  resolve(param: string): ResolvedTab | null {
    const { kind: kindName, payload } = splitParam(param);
    const kind = this.#kinds.get(kindName);
    if (!kind) return null;

    const addr = kind.match(payload);
    if (addr === null) return null;

    return {
      param: `${kind.kind}:${kind.toParam(addr)}`,
      title: kind.title(addr),
      render: () => kind.render(addr),
    };
  }
}
