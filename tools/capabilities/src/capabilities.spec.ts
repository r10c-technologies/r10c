import {
  barrelReaches,
  declaredEntityResources,
  declaredUseCases,
  expandApis,
  SLICES,
} from '@r10c/slices';
import { describe, expect, it } from 'vitest';

import { DOMAINS } from './domains.js';
import { CAPABILITIES } from './registry.js';
import { coverageProblems, registerProblems, type World } from './resolve.js';
import type { Capability } from './types.js';
import { realWorld } from './world.js';

const world = realWorld({
  resources: declaredEntityResources(),
  useCases: declaredUseCases().map(u => ({
    ...u,
    reachable: barrelReaches(u.packageName, u.file),
  })),
  slices: SLICES.map(slice => ({
    domains: slice.domains,
    endpoints: expandApis(slice.exposedAPIs),
  })),
});

describe('The capability register matches the source tree (ADR 0080)', () => {
  it('finds the source it is meant to check', () => {
    // A scan that silently stopped matching would make every check below pass
    // while asserting nothing, so the counts are pinned from below.
    expect(world.useCases.length).toBeGreaterThanOrEqual(17);
    expect(
      world.useCases.every(u => !u.resource.startsWith('unresolved:')),
    ).toBe(true);
    expect(world.entities.size).toBeGreaterThanOrEqual(30);
    expect([...world.recipes].sort()).toEqual([
      'cancellation',
      'checkout',
      'delivery',
    ]);
    expect(world.screens.size).toBeGreaterThanOrEqual(20);
    expect(world.screens.has('storefront:cart')).toBe(true);
    expect(world.crossing.size).toBeGreaterThanOrEqual(10);
  });

  // `planned` is not required here: it is the status of what a milestone
  // committed to and nobody built yet, so a register where every commitment
  // is built is a true one. The check a `planned` entry meets is pinned by the
  // fixtures below ("refuses a planned entry whose id resolves to code"),
  // which do not depend on the register's contents.
  it('holds an implemented and an in-design entry, so each check has something to say', () => {
    for (const status of ['implemented', 'in-design']) {
      expect(CAPABILITIES.some(c => c.status === status)).toBe(true);
    }
  });

  it('agrees with the source on every entry', () => {
    expect(registerProblems(CAPABILITIES, world)).toEqual([]);
  });

  it('accounts for every @useCase() and every flow recipe', () => {
    expect(coverageProblems(CAPABILITIES, world)).toEqual([]);
  });

  it('writes each domain once in the domain table', () => {
    const names = DOMAINS.map(row => row.domain);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('Each check can fail (planted)', () => {
  const real = (id: string): Capability => {
    const found = CAPABILITIES.find(c => c.id === id);
    if (found === undefined) throw new Error(`no entry ${id}`);
    return found;
  };
  const cancel = real('order-management:product-order:cancel');
  const withEntry = (patch: Partial<Capability>): Capability => ({
    ...cancel,
    ...patch,
  });
  const problemsOf = (entry: Capability, w: World = world) =>
    registerProblems([entry], w).join('\n');

  it('refuses an implemented entry that names no code', () => {
    expect(
      problemsOf(withEntry({ id: 'order-management:product-order:vanish' })),
    ).toContain('resolves to no @useCase');
  });

  it('refuses a verb its package barrel cannot reach', () => {
    const unreachable: World = {
      ...world,
      useCases: world.useCases.map(u => ({ ...u, reachable: false })),
    };
    expect(problemsOf(cancel, unreachable)).toContain(
      'resolves to no @useCase',
    );
  });

  it('refuses an unknown entity, permission and screen', () => {
    const bad = problemsOf(
      withEntry({
        entities: ['order-management:product-order', 'order-management:ghost'],
        permissions: ['order-management:product-order:nobody-holds-this'],
        screens: ['operation:ghost'],
      }),
    );
    expect(bad).toContain("'order-management:ghost', which nothing declares");
    expect(bad).toContain('nobody-holds-this');
    expect(bad).toContain("'operation:ghost'");
  });

  it('refuses a storefront screen that is not a storePaths key', () => {
    expect(problemsOf(withEntry({ screens: ['storefront:ghost'] }))).toContain(
      'storefront:ghost',
    );
  });

  it("refuses a subject that is not the id's own entity", () => {
    expect(
      problemsOf(withEntry({ entities: ['order-management:checkout-group'] })),
    ).toContain('as its subject');
  });

  it('refuses a planned entry whose id resolves to code', () => {
    expect(problemsOf(withEntry({ status: 'planned' }))).toContain(
      'the code landed and the entry was not promoted',
    );
    expect(problemsOf(withEntry({ status: 'in-design' }))).toContain(
      'not promoted',
    );
  });

  it('refuses an oda that disagrees with the domain, unless it says why', () => {
    expect(problemsOf(withEntry({ oda: 'TMFC999' }))).toContain('odaOverride');
    expect(
      problemsOf(
        withEntry({ oda: 'TMFC999', odaOverride: 'a different view' }),
      ),
    ).toBe('');
  });

  it('refuses a duplicate id, an empty or unknown vertical, and a malformed id', () => {
    expect(registerProblems([cancel, cancel], world).join()).toContain(
      'declared twice',
    );
    expect(problemsOf(withEntry({ verticals: [] }))).toContain('no vertical');
    expect(
      problemsOf(withEntry({ verticals: ['gardening' as never] })),
    ).toContain('unknown vertical');
    expect(
      problemsOf(withEntry({ id: 'order-management:cancel' as never })),
    ).toContain('is not <domain>');
  });

  it('refuses an entry in a domain the table does not name', () => {
    expect(
      problemsOf(
        withEntry({ id: 'unnamed-domain:thing:do', status: 'planned' }),
      ),
    ).toContain('not in DOMAINS');
  });

  it('fails a verb with no entry', () => {
    const without = CAPABILITIES.filter(c => c.id !== cancel.id);
    expect(coverageProblems(without, world)).toContain(
      "@useCase 'order-management:product-order:cancel' has no implemented entry",
    );
  });

  it('fails a verb whose entry is only planned', () => {
    const demoted = CAPABILITIES.map(c =>
      c.id === cancel.id ? { ...c, status: 'planned' as const } : c,
    );
    expect(coverageProblems(demoted, world).join()).toContain(cancel.id);
  });

  it('fails a flow recipe with no entry', () => {
    const w: World = {
      ...world,
      recipes: new Set([...world.recipes, 'refund']),
    };
    expect(coverageProblems(CAPABILITIES, w)).toContain(
      "flow recipe 'refund' has no implemented entry",
    );
    const noCheckout = CAPABILITIES.filter(
      c => c.id !== 'order-management:checkout-group:checkout',
    );
    // sell-at-channel also starts `checkout`, so the recipe is still reached
    // through a verb; with that verb's entry gone too it is not.
    const neither = noCheckout.filter(
      c => c.id !== 'sales-management:sales-channel:sell',
    );
    expect(coverageProblems(neither, world).join()).toContain(
      "flow recipe 'checkout'",
    );
  });

  it('resolves CRUD only when a slice serves the entity', () => {
    const crud = real(
      'product-configuration-management:product-offering:write',
    );
    expect(problemsOf(crud)).toBe('');
    const unserved: World = { ...world, serves: () => false };
    expect(problemsOf(crud, unserved)).toContain('resolves to no @useCase');
  });
});
