/**
 * The second gate, and the same failure the error-code scan exists for.
 *
 * A `@useCase()` descriptor names catalog keys — `labelKey`, `keywordsKey`, a
 * confirmation `messageKey` — and every one of them is a **runtime** key: the
 * browser resolves it through `useTranslateKey`, whose cast discards the
 * `CustomTypeOptions` augmentation. So a mistyped key compiles clean.
 *
 * `tools/check-i18n.mjs` cannot see it either. It compares `es` against `en`,
 * and a key missing from both locales is perfectly symmetric. The user reads the
 * raw key off the button.
 *
 * ADR 0026 assigns this to `@r10c/i18n-check`, which is why it lives here rather
 * than beside the source scan that feeds it.
 */
import { resources } from '@r10c/entifix-ts-i18n';
import { declaredUseCases } from '@r10c/slices';
import { describe, expect, it } from 'vitest';

/** `es` is the reference locale; `en` is typed from it, so parity is a compile
 * error and this file only needs to look at one. */
const catalog = resources.es as unknown as Record<string, unknown>;

/** Walk `<namespace>:<dotted.path>` through the catalog to a string. */
export const resolves = (key: string): boolean => {
  const [namespace, path] = key.split(':');
  if (path === undefined) return false;
  let node: unknown = catalog[namespace];
  for (const segment of path.split('.')) {
    if (typeof node !== 'object' || node === null) return false;
    node = (node as Record<string, unknown>)[segment];
  }
  return typeof node === 'string' && node.length > 0;
};

describe('The resolver', () => {
  it('follows a namespaced dotted path to a sentence', () => {
    expect(resolves('entity:user-identity.label')).toBe(true);
  });

  it('rejects a key that names no namespace', () => {
    expect(resolves('user-identity.label')).toBe(false);
  });

  it('rejects a path that runs off the catalog', () => {
    expect(resolves('entity:user-identity.nope.deeper')).toBe(false);
  });

  it('rejects a path that stops on an object rather than a sentence', () => {
    expect(resolves('entity:user-identity.fields')).toBe(false);
  });
});

describe('Catalog keys named by a use-case descriptor', () => {
  const declared = declaredUseCases();

  it('finds the declarations it is meant to check', () => {
    // A scan that silently stops matching would make the assertion below pass
    // while checking nothing — the guard `slices.spec.ts` and `docs.spec.ts` use.
    expect(declared.length).toBeGreaterThanOrEqual(2);
    expect(
      declared.flatMap(useCase => useCase.catalogKeys).length,
    ).toBeGreaterThanOrEqual(3);
  });

  it('all resolve in the reference catalog', () => {
    for (const useCase of declared) {
      for (const key of useCase.catalogKeys) {
        expect(
          resolves(key),
          `${useCase.className} names the catalog key '${key}', which the es ` +
            'catalog does not define. Nothing else can see this: the render ' +
            'path casts the key type away, and a key missing from both ' +
            'locales is symmetric, so the parity check passes too.',
        ).toBe(true);
      }
    }
  });
});
