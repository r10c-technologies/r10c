/**
 * The cell dependency rule, proved against a planted edge.
 *
 * ADR 0060's rule is a list of banned specifiers in `eslint.config.mjs`, and a
 * list fails silently: rename a package, mistype a glob, drop a dimension from
 * `sourceConstraints`, and every cell goes on linting clean while the rule
 * catches nothing. So this lints source that **breaks** the rule, through the
 * repository's real configuration and the real project graph, at a path inside
 * a real cell — and fails if the build would let it through.
 *
 * Each planted import is paired with a legal one, so a configuration that
 * simply errors on everything cannot pass either.
 */
import { join } from 'node:path';

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..');

/** A file that does not exist, placed where a `tech:next` cell's source lives. */
const IN_A_NEXT_CELL = join(
  REPO_ROOT,
  'packages/implementation/marketplace-catalog/next/src/planted.ts',
);

const BOUNDARY_RULE = '@nx/enforce-module-boundaries';

const boundaryErrors = async (code: string): Promise<string[]> => {
  const eslint = new ESLint({ cwd: REPO_ROOT });
  const [result] = await eslint.lintText(code, { filePath: IN_A_NEXT_CELL });
  return (result?.messages ?? [])
    .filter(message => message.ruleId === BOUNDARY_RULE)
    .map(message => message.message);
};

describe('a next cell', () => {
  it.each([
    ["import { makeEntityMetadataSource } from '@entifix/rest';", 'an adapter'],
    [
      "import { MongoClientLayer } from '@entifix/mongo';",
      'a datastore client',
    ],
    [
      "import { serviceToken } from '@entifix/next-shell/server';",
      'the server half of the shell',
    ],
    ["import { useQuery } from '@tanstack/react-query';", 'a state mechanism'],
    [
      "import { runSaga } from '@entifix/transactions/engine';",
      'the saga engine',
    ],
    [
      "import { makeService } from '@entifix/service-shell/runtime';",
      'the service runtime',
    ],
  ])(
    'may not import %s (%s)',
    async source => {
      const errors = await boundaryErrors(`${source}\nexport {};\n`);

      expect(errors.length).toBe(1);
    },
    60_000,
  );

  it.each([
    ["import { loadUCFactory } from '@entifix/business';", 'a use case'],
    ["import type { EntityPage } from '@entifix/core';", 'an entity contract'],
    [
      "import type { SagaStore } from '@entifix/transactions';",
      'a transactions port',
    ],
    [
      "import { PublishedOffering } from '@r10c/business-ts-marketplace-catalog';",
      'its own domain',
    ],
  ])(
    'may import %s (%s)',
    async source => {
      const errors = await boundaryErrors(`${source}\nexport {};\n`);

      expect(errors).toEqual([]);
    },
    60_000,
  );

  // Cell→cell needs no ban of its own: `layer:implementation` allows no
  // same-layer edge. Asserted anyway, because it is the half of the rule the
  // ADR leans on most and nothing else here would notice it going.
  it('may not import another cell', async () => {
    const errors = await boundaryErrors(
      "import { loadBrands } from '@r10c/implementation-catalog-reference-next';\nexport {};\n",
    );

    expect(errors.length).toBe(1);
  }, 60_000);
});
