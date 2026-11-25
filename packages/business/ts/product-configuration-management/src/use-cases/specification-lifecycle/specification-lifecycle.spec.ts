import { EntityRepositoryFactoryTag } from '@entifix/business';
import { describeEntityUseCases } from '@entifix/core';
import { makeInMemoryEntityRepository } from '@entifix/testing-unit';
import { Cause, Effect, Exit, Layer, Option } from 'effect';
import { describe, expect, it } from 'vitest';

import { ProductOffering } from '../../entities/product-offering/product-offering.entity.js';
import { ProductSpecification } from '../../entities/product-specification/product-specification.entity.js';
import {
  type SpecificationCommands,
  SpecificationCommandsTag,
} from '../../ports/offering-catalog.js';
import { contentHashOf } from '../../values/specification-lifecycle.js';
import {
  SPECIFICATION_BEING_REVISED,
  SPECIFICATION_CHANGED,
  SPECIFICATION_NOT_TRANSITIONABLE,
  SPECIFICATION_STILL_PINNED,
} from './specification-failures.js';
import {
  moveSpecificationFor,
  preserveSpecificationLifecycle,
  removeSpecificationFor,
  reviseSpecificationFor,
  startSpecificationSeries,
} from './specification-flows.js';
import {
  OBSOLETE_PRODUCT_SPECIFICATION,
  ObsoleteProductSpecificationUC,
  RELEASE_PRODUCT_SPECIFICATION,
  ReleaseProductSpecificationUC,
  RETIRE_PRODUCT_SPECIFICATION,
  RetireProductSpecificationUC,
  REVISE_PRODUCT_SPECIFICATION,
  ReviseProductSpecificationUC,
} from './specification-lifecycle.uc.js';

const AT = new Date('2026-11-19T10:00:00.000Z');

const version = (
  id: string,
  lifecycleStatus: NonNullable<ProductSpecification['lifecycleStatus']>,
  overrides: Partial<ProductSpecification> = {},
) =>
  Object.assign(new ProductSpecification('product-001', 'A mug'), {
    id,
    specKey: 'product-001',
    version: 1,
    lifecycleStatus,
    description: 'Glazed by hand.',
    revision: 4,
    ...overrides,
  });

const offering = (status: ProductOffering['status'], specificationId: string) =>
  Object.assign(new ProductOffering('A mug', specificationId), {
    id: `o-${status}`,
    status,
  });

interface Stores {
  readonly specifications?: ProductSpecification[];
  readonly offerings?: ProductOffering[];
  readonly outcome?: 'committed' | 'changed';
  readonly removal?: 'removed' | 'changed' | 'absent';
}

const world = (stores: Stores = {}) => {
  const moved: { specification: ProductSpecification; from: string }[] = [];
  const revised: ProductSpecification[] = [];
  const specifications = makeInMemoryEntityRepository(
    stores.specifications ?? [],
  );
  const offerings = makeInMemoryEntityRepository(stores.offerings ?? []);
  const commands: SpecificationCommands = {
    create: (_organizationId, specification) => Effect.succeed(specification),
    move: (_organizationId, specification, from) =>
      Effect.sync(() => {
        moved.push({ specification, from });
        return stores.outcome ?? 'committed';
      }),
    revise: (_organizationId, next) =>
      Effect.sync(() => {
        revised.push(next);
        return stores.outcome ?? 'committed';
      }),
    remove: () => Effect.succeed(stores.removal ?? 'removed'),
  };
  const layer = Layer.mergeAll(
    Layer.succeed(EntityRepositoryFactoryTag, {
      for: entity =>
        Effect.succeed(
          (entity as unknown) === ProductOffering ? offerings : specifications,
        ),
    }),
    Layer.succeed(SpecificationCommandsTag, commands),
  );
  const exit = <A, E>(
    effect: Effect.Effect<
      A,
      E,
      EntityRepositoryFactoryTag | SpecificationCommandsTag
    >,
  ) =>
    Effect.runPromiseExit(effect.pipe(Effect.provide(layer))) as Promise<
      Exit.Exit<A, E>
    >;
  return { moved, revised, exit };
};

const codeOf = (exit: Exit.Exit<unknown, unknown>) => {
  if (!Exit.isFailure(exit)) throw new Error('expected a failure');
  return (
    Option.getOrThrow(Cause.findErrorOption(exit.cause)) as {
      readonly code: string;
    }
  ).code;
};

const valueOf = <A>(exit: Exit.Exit<A, unknown>): A => {
  if (!Exit.isSuccess(exit)) throw new Error('expected a success');
  return exit.value;
};

describe('the four verbs', () => {
  it('each declares the states it is offered in, and its own permission', () => {
    const offered = describeEntityUseCases(ProductSpecification).map(
      descriptor => [descriptor.key, descriptor.availableWhen],
    );

    expect(offered).toEqual([
      ['release', { member: 'lifecycleStatus', in: ['in-design'] }],
      ['revise', { member: 'lifecycleStatus', in: ['active'] }],
      ['retire', { member: 'lifecycleStatus', in: ['active'] }],
      ['obsolete', { member: 'lifecycleStatus', in: ['retired'] }],
    ]);
    expect([
      RELEASE_PRODUCT_SPECIFICATION,
      REVISE_PRODUCT_SPECIFICATION,
      RETIRE_PRODUCT_SPECIFICATION,
      OBSOLETE_PRODUCT_SPECIFICATION,
    ]).toEqual([
      'product-configuration-management:product-specification:release',
      'product-configuration-management:product-specification:revise',
      'product-configuration-management:product-specification:retire',
      'product-configuration-management:product-specification:obsolete',
    ]);
  });

  it('decides a move only from the state it is legal from', async () => {
    const run = (
      status: NonNullable<ProductSpecification['lifecycleStatus']>,
    ) =>
      Effect.runPromiseExit(
        RetireProductSpecificationUC.run(version('s-1', status)),
      );

    expect(valueOf(await run('active'))).toEqual({
      from: 'active',
      to: 'retired',
    });
    expect(codeOf(await run('in-design'))).toBe(
      SPECIFICATION_NOT_TRANSITIONABLE,
    );
  });

  it('decides a revise and an obsolete from where they are offered', async () => {
    const revise = await Effect.runPromise(
      ReviseProductSpecificationUC.run(version('s-1', 'active')),
    );
    const obsolete = await Effect.runPromise(
      ObsoleteProductSpecificationUC.run(version('s-1', 'retired')),
    );

    expect([revise, obsolete]).toEqual([
      { from: 'active', to: 'active' },
      { from: 'retired', to: 'obsolete' },
    ]);
  });

  it('refuses a version that names no state at all', async () => {
    const exit = await Effect.runPromiseExit(
      ReleaseProductSpecificationUC.run(
        version('s-1', 'in-design', { lifecycleStatus: undefined }),
      ),
    );

    expect(codeOf(exit)).toBe(SPECIFICATION_NOT_TRANSITIONABLE);
  });
});

describe('the content hash', () => {
  it('ignores key order and absent members, and sees every member that is there', async () => {
    const hash = (content: Record<string, unknown>) =>
      Effect.runPromise(contentHashOf(content));
    const media = [{ alt: 'A mug', url: 'https://example.test/mug.png' }];

    const one = await hash({ name: 'A mug', media, description: undefined });
    const same = await hash({
      media: [{ url: 'https://example.test/mug.png', alt: 'A mug' }],
      name: 'A mug',
    });
    const other = await hash({ name: 'A mug', media, description: 'New' });

    expect(one).toMatch(/^[0-9a-f]{64}$/);
    expect(same).toBe(one);
    expect(other).not.toBe(one);
  });
});

describe('moving a version', () => {
  it('releases a version in design: frozen, stamped and hashed', async () => {
    const w = world({ specifications: [version('s-1', 'in-design')] });

    const released = valueOf(
      await w.exit(
        moveSpecificationFor({
          organizationId: 'acme',
          id: 's-1',
          move: 'release',
          at: AT,
        }),
      ),
    );

    expect(released).toMatchObject({
      lifecycleStatus: 'active',
      validFrom: AT,
      validTo: undefined,
      contentHash: await Effect.runPromise(contentHashOf(released)),
    });
    expect(w.moved.map(one => one.from)).toEqual(['in-design']);
  });

  it('retires the active version at the moment it was asked', async () => {
    const w = world({ specifications: [version('s-1', 'active')] });

    const retired = valueOf(
      await w.exit(
        moveSpecificationFor({
          organizationId: 'acme',
          id: 's-1',
          move: 'retire',
          at: AT,
        }),
      ),
    );

    expect(retired).toMatchObject({ lifecycleStatus: 'retired', validTo: AT });
  });

  it('stamps a release with the clock when no moment is given', async () => {
    const w = world({ specifications: [version('s-1', 'in-design')] });

    const released = valueOf(
      await w.exit(
        moveSpecificationFor({
          organizationId: 'acme',
          id: 's-1',
          move: 'release',
        }),
      ),
    );

    expect(released.validFrom).toBeInstanceOf(Date);
  });

  it('refuses a move the store saw another one beat', async () => {
    const w = world({
      specifications: [version('s-1', 'in-design')],
      outcome: 'changed',
    });

    const exit = await w.exit(
      moveSpecificationFor({
        organizationId: 'acme',
        id: 's-1',
        move: 'release',
      }),
    );

    expect(codeOf(exit)).toBe(SPECIFICATION_CHANGED);
  });

  it('refuses an illegal move before writing anything', async () => {
    const w = world({ specifications: [version('s-1', 'active')] });

    const exit = await w.exit(
      moveSpecificationFor({
        organizationId: 'acme',
        id: 's-1',
        move: 'release',
      }),
    );

    expect(codeOf(exit)).toBe(SPECIFICATION_NOT_TRANSITIONABLE);
    expect(w.moved).toEqual([]);
  });

  it('makes a retired version obsolete when nothing published pins it', async () => {
    const w = world({
      specifications: [version('s-1', 'retired')],
      // An unpublished offering is not "live".
      offerings: [offering('unpublished', 's-1')],
    });

    const obsolete = valueOf(
      await w.exit(
        moveSpecificationFor({
          organizationId: 'acme',
          id: 's-1',
          move: 'obsolete',
        }),
      ),
    );

    expect(obsolete.lifecycleStatus).toBe('obsolete');
  });

  it('refuses to make obsolete a version a published offering sells', async () => {
    const w = world({
      specifications: [version('s-1', 'retired')],
      offerings: [offering('published', 's-1')],
    });

    const exit = await w.exit(
      moveSpecificationFor({
        organizationId: 'acme',
        id: 's-1',
        move: 'obsolete',
      }),
    );

    expect(codeOf(exit)).toBe(SPECIFICATION_STILL_PINNED);
    expect(w.moved).toEqual([]);
  });

  it('answers a version that does not exist as not found', async () => {
    const exit = await world().exit(
      moveSpecificationFor({
        organizationId: 'acme',
        id: 'nope',
        move: 'retire',
      }),
    );

    expect(codeOf(exit)).toBe('notFound');
  });
});

describe('revising a version', () => {
  it('opens the next version in design as a copy of what the active one says', async () => {
    const media = [{ url: 'https://example.test/mug.png', alt: 'A mug' }];
    const w = world({
      specifications: [
        version('s-1', 'active', {
          brandId: 'b-1',
          categoryId: 'c-1',
          media,
          fitsDeviceModelIds: ['universal'],
        }),
      ],
    });

    const next = valueOf(
      await w.exit(
        reviseSpecificationFor({ organizationId: 'acme', id: 's-1' }),
      ),
    );

    expect(next).toMatchObject({
      code: 'product-001',
      specKey: 'product-001',
      version: 2,
      lifecycleStatus: 'in-design',
      name: 'A mug',
      description: 'Glazed by hand.',
      brandId: 'b-1',
      categoryId: 'c-1',
      media,
      fitsDeviceModelIds: ['universal'],
    });
    expect(next.id).not.toBe('s-1');
    expect(w.revised).toEqual([next]);
  });

  it('refuses while the series already has a version in design', async () => {
    const w = world({
      specifications: [
        version('s-1', 'active'),
        version('s-2', 'in-design', { version: 2 }),
      ],
    });

    const exit = await w.exit(
      reviseSpecificationFor({ organizationId: 'acme', id: 's-1' }),
    );

    expect(codeOf(exit)).toBe(SPECIFICATION_BEING_REVISED);
    expect(w.revised).toEqual([]);
  });

  it('refuses when another revise took the next number first', async () => {
    const w = world({
      specifications: [version('s-1', 'active')],
      outcome: 'changed',
    });

    const exit = await w.exit(
      reviseSpecificationFor({ organizationId: 'acme', id: 's-1' }),
    );

    expect(codeOf(exit)).toBe(SPECIFICATION_BEING_REVISED);
  });

  it('revises only an active version', async () => {
    const exit = await world({
      specifications: [version('s-1', 'retired')],
    }).exit(reviseSpecificationFor({ organizationId: 'acme', id: 's-1' }));

    expect(codeOf(exit)).toBe(SPECIFICATION_NOT_TRANSITIONABLE);
  });

  it('numbers from 1 when the active version names none', async () => {
    const next = valueOf(
      await world({
        specifications: [version('s-1', 'active', { version: undefined })],
      }).exit(reviseSpecificationFor({ organizationId: 'acme', id: 's-1' })),
    );

    expect(next.version).toBe(1);
  });
});

describe('deleting a version', () => {
  it('answers the id it removed', async () => {
    const exit = await world().exit(
      removeSpecificationFor({ organizationId: 'acme', id: 's-1' }),
    );

    expect(valueOf(exit)).toBe('s-1');
  });

  it('refuses a released version: orders name it', async () => {
    const exit = await world({ removal: 'changed' }).exit(
      removeSpecificationFor({ organizationId: 'acme', id: 's-1' }),
    );

    expect(codeOf(exit)).toBe('unavailableInState');
  });

  it('answers nothing by that id as not found', async () => {
    const exit = await world({ removal: 'absent' }).exit(
      removeSpecificationFor({ organizationId: 'acme', id: 's-1' }),
    );

    expect(codeOf(exit)).toBe('notFound');
  });
});

describe('a save', () => {
  it('starts a new series in design at version 1, whatever the body said', () => {
    const started = startSpecificationSeries(
      version('s-1', 'active', {
        version: 9,
        validFrom: AT,
        validTo: AT,
        contentHash: 'forged',
      }),
    );

    expect(started).toMatchObject({
      version: 1,
      lifecycleStatus: 'in-design',
      specKey: undefined,
      validFrom: undefined,
      validTo: undefined,
      contentHash: undefined,
    });
  });

  it('starts a series when the body names no id', async () => {
    const started = valueOf(
      await world().exit(
        preserveSpecificationLifecycle(
          version('s-1', 'active', { id: undefined }),
          'acme',
        ),
      ),
    );

    expect(started.lifecycleStatus).toBe('in-design');
  });

  it('carries the lifecycle across from what is stored on a version in design', async () => {
    const stored = version('s-1', 'in-design', { version: 2 });
    const body = version('s-1', 'active', {
      name: 'A renamed mug',
      code: '',
      specKey: 'forged',
      version: 7,
    });

    const kept = valueOf(
      await world({ specifications: [stored] }).exit(
        preserveSpecificationLifecycle(body, 'acme'),
      ),
    );

    expect(kept).toMatchObject({
      name: 'A renamed mug',
      code: 'product-001',
      specKey: 'product-001',
      version: 2,
      lifecycleStatus: 'in-design',
    });
  });

  it('carries a released version’s stored state onto the edit, for the store to refuse', async () => {
    const exit = await world({
      specifications: [version('s-1', 'active')],
    }).exit(
      preserveSpecificationLifecycle(version('s-1', 'in-design'), 'acme'),
    );

    expect(valueOf(exit)).toMatchObject({ lifecycleStatus: 'active' });
  });
});
