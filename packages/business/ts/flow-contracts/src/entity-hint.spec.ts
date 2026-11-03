import { decodeEvent, type DomainEvent, encodeEvent } from '@entifix/core';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { ENTITY_CHANGED, entityHint } from './index.js';

const placed: DomainEvent = {
  name: 'order.placed',
  id: 'evt-1',
  source: 'order',
  at: '2026-11-03T00:00:00.000Z',
  correlationId: 'corr-1',
  aggregate: { type: 'product-order', id: 'o-1' },
  version: 3,
  audience: [{ kind: 'organization', id: 'org-a' }],
  data: { id: 'o-1' },
};

describe('entityHint', () => {
  it('keeps identity and audience, and drops the aggregate and version', () => {
    const hint = entityHint(placed, {
      entity: 'product-order',
      change: 'created',
      id: 'o-1',
    });

    expect(hint).toEqual({
      name: ENTITY_CHANGED,
      id: 'evt-1',
      source: 'order',
      at: '2026-11-03T00:00:00.000Z',
      correlationId: 'corr-1',
      audience: [{ kind: 'organization', id: 'org-a' }],
      data: { entity: 'product-order', change: 'created', id: 'o-1' },
    });
  });

  it('omits what the domain event did not carry', () => {
    const bare: DomainEvent = { ...placed };
    delete bare.correlationId;
    delete bare.audience;
    const hint = entityHint(bare, {
      entity: 'product-order',
      change: 'deleted',
      id: 'o-1',
    });

    expect(hint).not.toHaveProperty('correlationId');
    expect(hint).not.toHaveProperty('audience');
  });

  it('round-trips through the registry', async () => {
    const hint = entityHint(placed, {
      entity: 'product-order',
      change: 'updated',
      id: 'o-1',
    });
    const decoded = await Effect.runPromise(
      Effect.flatMap(encodeEvent(hint), decodeEvent),
    );

    expect(decoded.data).toEqual(hint.data);
  });

  it('refuses to encode a hint with no audience', async () => {
    const bare: DomainEvent = { ...placed };
    delete bare.audience;
    const exit = await Effect.runPromiseExit(
      encodeEvent(
        entityHint(bare, { entity: 'product-order', change: 'updated', id: 1 }),
      ),
    );

    expect(Exit.isFailure(exit)).toBe(true);
  });
});
