import { EntifixLogicError } from '@r10c/entifix-ts-core';

/** The `{a.b.c}` placeholders a {@link SagaCall}'s path may carry. */
const PLACEHOLDER = /\{([^{}]+)\}/g;

const readPath = (root: unknown, path: string): unknown => {
  let value = root;
  for (const segment of path.split('.')) {
    if (value === null || typeof value !== 'object') {
      return undefined;
    }
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
};

/**
 * Resolve a path template against a scope.
 *
 * `/api/reservation/{outcome.data.id}` with
 * `{ outcome: { data: { id: 'r-1' } } }` becomes `/api/reservation/r-1`.
 *
 * ⚠️ **An unresolved placeholder throws rather than interpolating `undefined`.**
 * The failure this prevents is specific and silent: a compensation whose
 * template no longer matches its participant's response shape would otherwise
 * `DELETE /api/reservation/undefined`, get a `404`, and be recorded as a
 * compensation that ran — leaving the hold in place and the saga reporting that
 * it was reversed. That is the "failed and stranded" state ADR 0039 says nobody
 * plans for, arrived at by string interpolation.
 *
 * Values are URI-encoded: a participant's id is data, and a path segment is not
 * the place to discover it contained a slash.
 */
export function resolveTemplate(
  template: string,
  scope: Record<string, unknown>,
): string {
  return template.replaceAll(PLACEHOLDER, (_match, path: string) => {
    const value = readPath(scope, path);
    if (value === undefined || value === null) {
      throw new EntifixLogicError(
        `saga path template '${template}' has no value for '{${path}}'`,
        undefined,
        { template, path },
      );
    }
    return encodeURIComponent(String(value));
  });
}

/** A string that is nothing but one placeholder, so its type can be preserved. */
const WHOLE_PLACEHOLDER = /^\{([^{}]+)\}$/;

/**
 * Resolve the placeholders inside a **request body**, recursively.
 *
 * ⚠️ **Why a body needs this at all.** A step's payload can depend on what an
 * earlier step created: checkout's capture has to name the order that was just
 * written, and the order id is minted by order-service — so a caller cannot put
 * it in the body it sends when it starts the flow. Without this, the capture
 * carries a placeholder string and the order it names never advances, which is
 * precisely the defect measured on the live lab: a saga reporting `COMPLETED`
 * with a payment attached to nothing.
 *
 * ⚠️ **The template lives in the caller's `inputs`, never in the definition.**
 * That is ADR 0039's constraint, not an accident: a definition that carried
 * domain payloads would be importing the shape of another domain's entity, which
 * is the class of thing that has no legal home. The definition stays a list of
 * verbs and addresses; what to send is the caller's, and this only lets the
 * caller point at a value it could not have known yet.
 *
 * Two behaviours, and the difference is load-bearing:
 *
 * - A string that is **exactly** one placeholder resolves to the raw value, so
 *   a number stays a number and an object stays an object. `"{steps.x.data.qty}"`
 *   becoming the string `"3"` would reach a validator expecting a number.
 * - A string that merely **contains** placeholders is interpolated textually,
 *   and — unlike {@link resolveTemplate} — **not** URI-encoded. A body is JSON,
 *   not a path segment; encoding here would put `%20` in a customer's name.
 *
 * An unresolved placeholder throws, for the same reason it does in a path.
 */
export function resolveBodyTemplate(
  value: unknown,
  scope: Record<string, unknown>,
): unknown {
  if (typeof value === 'string') {
    const whole = WHOLE_PLACEHOLDER.exec(value);
    if (whole?.[1] !== undefined) {
      const resolved = readPath(scope, whole[1]);
      if (resolved === undefined || resolved === null) {
        throw new EntifixLogicError(
          `saga body template '${value}' has no value for '{${whole[1]}}'`,
          undefined,
          { template: value, path: whole[1] },
        );
      }
      return resolved;
    }
    return value.replaceAll(PLACEHOLDER, (_match, path: string) => {
      const resolved = readPath(scope, path);
      if (resolved === undefined || resolved === null) {
        throw new EntifixLogicError(
          `saga body template '${value}' has no value for '{${path}}'`,
          undefined,
          { template: value, path },
        );
      }
      return String(resolved);
    });
  }

  if (Array.isArray(value)) {
    return value.map(element => resolveBodyTemplate(element, scope));
  }

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        resolveBodyTemplate(entry, scope),
      ]),
    );
  }

  return value;
}
