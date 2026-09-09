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
