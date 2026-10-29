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
    ["import { compose } from '@entifix/business/compose';", 'the composer'],
    [
      "import { verifiedContext } from '@entifix/business/verified';",
      'the context constructor',
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

/**
 * The shell ordering (ADR 0064), proved the same way: a planted edge through
 * the real configuration, at a path inside a real shell, beside a legal twin.
 *
 * Each planted edge is one the **scope** rule would let through, so a failure
 * here is the `shell:*` dimension's alone: the Next and Effect order shells
 * share `scope:order`, and the base and the system-management shell are both
 * `scope:shared`.
 */
const shellBoundaryErrors = async (
  shell: string,
  code: string,
): Promise<string[]> => {
  const eslint = new ESLint({ cwd: REPO_ROOT });
  const [result] = await eslint.lintText(`${code}\nexport {};\n`, {
    filePath: join(REPO_ROOT, 'packages/shells', shell, 'src/planted.ts'),
  });
  return (result?.messages ?? [])
    .filter(message => message.ruleId === BOUNDARY_RULE)
    .map(message => message.message);
};

describe('the shell kinds', () => {
  it('stop a domain shell importing another domain shell', async () => {
    expect(
      await shellBoundaryErrors(
        'effect/order',
        "import { orderNav } from '@r10c/shells-next-order';",
      ),
    ).toHaveLength(1);
  }, 60_000);

  it('let a domain shell import the base', async () => {
    expect(
      await shellBoundaryErrors(
        'effect/order',
        "import { fleetFailurePolicy } from '@r10c/shells-effect-service';",
      ),
    ).toEqual([]);
  }, 60_000);

  it('stop the base importing a slice’s shell', async () => {
    expect(
      await shellBoundaryErrors(
        'effect/service',
        "import { systemNav } from '@r10c/shells-next-system-management';",
      ),
    ).toHaveLength(1);
  }, 60_000);

  it('let the base import the shared core', async () => {
    expect(
      await shellBoundaryErrors(
        'effect/service',
        "import { fleetToken } from '@r10c/utils-ts-fleet';",
      ),
    ).toEqual([]);
  }, 60_000);
});

/**
 * Apps only mount (ADR 0064): a planted service file that wires routes or the
 * saga engine itself, or logs, beside a legal twin that mounts its shell.
 */
const appImportErrors = async (code: string): Promise<string[]> => {
  const eslint = new ESLint({ cwd: REPO_ROOT });
  const [result] = await eslint.lintText(`${code}\nexport {};\n`, {
    filePath: join(REPO_ROOT, 'apps/order-service/src/planted.ts'),
  });
  return (result?.messages ?? [])
    .filter(message => message.ruleId === 'no-restricted-imports')
    .map(message => message.message);
};

describe('a service app', () => {
  it.each([
    ["import { HttpRouter } from 'effect/http';", 'the router'],
    ["import { HttpApi } from 'effect/http-api';", 'an HTTP API'],
    ["import { runSaga } from '@entifix/transactions/engine';", 'the engine'],
    [
      "import { logSliceOutcome } from '@r10c/shells-effect-service';",
      'the shell log',
    ],
  ])(
    'may not import %s (%s)',
    async source => {
      expect(await appImportErrors(source)).toHaveLength(1);
    },
    60_000,
  );

  it('may import its slice shell', async () => {
    expect(
      await appImportErrors(
        "import { makeAppLayer } from '@r10c/shells-effect-order';",
      ),
    ).toEqual([]);
  }, 60_000);
});

/**
 * A consumer never retries in process (ADR 0064): planted handlers that retry
 * inside `subscribe(…)`, beside a legal twin that retries outside one.
 */
const consumerRetryErrors = async (body: string): Promise<string[]> => {
  const eslint = new ESLint({ cwd: REPO_ROOT });
  const code = [
    "import { On } from '@entifix/transactions';",
    "import { Effect } from 'effect';",
    'declare const bus: { subscribe: (s: unknown, h: unknown) => unknown };',
    body,
    'export {};',
  ].join('\n');
  const [result] = await eslint.lintText(code, {
    filePath: join(REPO_ROOT, 'packages/shells/effect/order/src/planted.ts'),
  });
  return (result?.messages ?? [])
    .filter(message => message.ruleId === 'no-restricted-syntax')
    .map(message => message.message);
};

describe('a slice shell consumer', () => {
  it.each([
    [
      'Effect.retry',
      'bus.subscribe({}, () => Effect.retry(Effect.void, { times: 2 }));',
    ],
    [
      'On(…).retry',
      "bus.subscribe({}, () => On(() => true).retry({ key: { dependency: 'x' }, idempotent: true })(Effect.void));",
    ],
  ])(
    'may not retry inside its handler (%s)',
    async (_label, body) => {
      expect(await consumerRetryErrors(body)).toHaveLength(1);
    },
    60_000,
  );

  it('may retry outside a handler', async () => {
    expect(
      await consumerRetryErrors(
        'export const call = Effect.retry(Effect.void, { times: 2 });',
      ),
    ).toEqual([]);
  }, 60_000);
});

/** The composer and the context constructor stay out of persistence cells and business. */
describe('below the shell', () => {
  const errorsAt = async (path: string, code: string) => {
    const eslint = new ESLint({ cwd: REPO_ROOT });
    const [result] = await eslint.lintText(`${code}\nexport {};\n`, {
      filePath: join(REPO_ROOT, path),
    });
    return (result?.messages ?? []).filter(
      message => message.ruleId === BOUNDARY_RULE,
    );
  };

  it.each([
    [
      'a persistence cell',
      'packages/implementation/order/mongo/src/planted.ts',
    ],
    [
      'a business package',
      'packages/business/ts/stock-management/src/planted.ts',
    ],
  ])(
    'may not compose a flow in %s',
    async (_label, path) => {
      for (const source of [
        "import { compose } from '@entifix/business/compose';",
        "import { verifiedContext } from '@entifix/business/verified';",
      ])
        expect(await errorsAt(path, source), source).toHaveLength(1);
    },
    60_000,
  );

  it('may declare fragments in a business package', async () => {
    expect(
      await errorsAt(
        'packages/business/ts/stock-management/src/planted.ts',
        "import { defineFragment } from '@entifix/business/flow';",
      ),
    ).toEqual([]);
  }, 60_000);
});
