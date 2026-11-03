import { EntityRepositoryTag } from '@entifix/business';
import { type EntityWriter, settled } from '@entifix/core';
import { makeInMemoryEntityRepository } from '@entifix/testing-unit';
import { render, screen } from '@testing-library/react';
import { Context, Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { createClientAdapters } from './adapters/create-client-adapters.js';
import type { SalesAdapters } from './client-types.js';
import { SalesProvider, useSalesAdapters } from './sales-context.js';

/**
 * A writer that settles every write through the spec's own in-memory
 * repository, as a write that commits in one unit does (ADR 0073).
 */
const settledWriter = (
  context: Context.Context<EntityRepositoryTag>,
): EntityWriter => {
  const repository = Context.get(context, EntityRepositoryTag);
  return {
    save: entity => Effect.map(repository.save(entity), settled),
    delete: entityOrId =>
      Effect.as(repository.delete(entityOrId), settled(undefined)),
  };
};

/** The transports the shell really composes, so metadata reads behave as in production. */
const real = createClientAdapters();

const stubAdapters = (): SalesAdapters => ({
  salesChannelRest: Context.make(
    EntityRepositoryTag,
    makeInMemoryEntityRepository([]),
  ),
  salesChannelWriter: settledWriter(
    Context.make(EntityRepositoryTag, makeInMemoryEntityRepository([])),
  ),
  publishedOfferingRest: Context.make(
    EntityRepositoryTag,
    makeInMemoryEntityRepository([]),
  ),
  metadata: real.metadata,
});

function Reader() {
  const adapters = useSalesAdapters();
  return <span>{Object.keys(adapters).join(',')}</span>;
}

describe('SalesProvider', () => {
  it('hands the pages below it the adapters it was given', () => {
    render(
      <SalesProvider adapters={stubAdapters()}>
        <Reader />
      </SalesProvider>,
    );

    expect(
      screen.getByText(
        'salesChannelRest,salesChannelWriter,publishedOfferingRest,metadata',
      ),
    ).toBeInTheDocument();
  });

  it('builds the real adapters when a host passes none', () => {
    render(
      <SalesProvider>
        <Reader />
      </SalesProvider>,
    );

    expect(screen.getByText(/salesChannelRest/)).toBeInTheDocument();
  });

  it('refuses to be read outside a provider', () => {
    // A hook that returned `undefined` here would fail later, inside a page,
    // as a property access on nothing.
    expect(() => render(<Reader />)).toThrow(/SalesProvider/);
  });
});
