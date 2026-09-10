import { PublishedOffering } from '@r10c/business-ts-marketplace-catalog';
import { SalesChannel } from '@r10c/business-ts-sales-management';
import { EntifixQueryProvider } from '@r10c/entifix-react-integration';
import {
  ConfigurationRepositoryTag,
  EntityRepositoryTag,
} from '@r10c/entifix-ts-business';
import type { Entity } from '@r10c/entifix-ts-core';
import {
  makeInMemoryEntityRepository,
  makeStubConfigurationClient,
} from '@r10c/entifix-ts-testing-unit';
import { render, screen, waitFor } from '@testing-library/react';
import { Context } from 'effect';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SalesAdapters } from './client-types.js';
import { SalesProvider } from './sales-context.js';
import {
  SALES_CRUDS,
  salesChannelCrud,
  SalesChannelListClientPage,
  SalesChannelSingleViewClientPage,
} from './sales-crud.js';

// These pages are `makeEntityCrud` output, so what is worth asserting is that
// the generator was handed the right facts — the adapter each screen reads, the
// route it lives at, and the members it offers.
let slug = 'new';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useParams: () => ({ slug }),
}));

const makeChannel = () => {
  const channel = new SalesChannel('Mostrador principal', 'counter');
  channel.id = 'sales-channel-counter';
  return channel;
};

let repositories: {
  channel: ReturnType<typeof makeInMemoryEntityRepository>;
  offering: ReturnType<typeof makeInMemoryEntityRepository>;
};

const adapters = (): SalesAdapters => ({
  salesChannelRest: Context.make(EntityRepositoryTag, repositories.channel),
  publishedOfferingRest: Context.make(
    EntityRepositoryTag,
    repositories.offering,
  ),
  configurationStore: Context.make(
    ConfigurationRepositoryTag,
    makeStubConfigurationClient(),
  ),
});

const renderPage = (page: ReactElement) =>
  render(
    <EntifixQueryProvider>
      <SalesProvider adapters={adapters()}>{page}</SalesProvider>
    </EntifixQueryProvider>,
  );

beforeEach(() => {
  slug = 'new';
  repositories = {
    channel: makeInMemoryEntityRepository([makeChannel()] as Entity[]),
    offering: makeInMemoryEntityRepository([] as Entity[]),
  };
});

describe('the sales descriptors', () => {
  it('exposes the screen the workspace registry derives its tab from', () => {
    expect(SALES_CRUDS.map(crud => crud.entityKey)).toEqual(['sales-channel']);
  });

  it('names the screen from the entity`s own decorator', () => {
    expect(salesChannelCrud.entityLabelKey).toBe('entity:sales-channel.label');
    expect(salesChannelCrud.entityPluralKey).toBe(
      'entity:sales-channel.plural',
    );
    expect(salesChannelCrud.basePath).toBe('/sales/sales-channel');
  });
});

describe('the channel screens', () => {
  it('lists the channels from the adapter it was given', async () => {
    renderPage(<SalesChannelListClientPage />);

    await waitFor(() =>
      expect(
        screen.getAllByText('Mostrador principal').length,
      ).toBeGreaterThan(0),
    );
  });

  it('offers the three authored members and hides the id', async () => {
    renderPage(<SalesChannelSingleViewClientPage />);

    expect(await screen.findByLabelText('Nombre')).toBeInTheDocument();
    expect(screen.getByLabelText('Tipo')).toBeInTheDocument();
    // ⚠️ `status` stays editable, and it is the member that matters: a channel
    // is retired by moving it to `inactive` rather than by deleting it, because
    // every order placed through it keeps naming it.
    expect(screen.getByLabelText('Estado')).toBeInTheDocument();
    expect(screen.queryByLabelText('ID')).not.toBeInTheDocument();
  });

  it('opens a channel by its slug', async () => {
    slug = 'sales-channel-counter';

    renderPage(<SalesChannelSingleViewClientPage />);

    await waitFor(() =>
      expect(
        screen.getAllByDisplayValue('Mostrador principal').length,
      ).toBeGreaterThan(0),
    );
  });
});

describe('the published projection adapter', () => {
  it('is a second backend, because the till sells what the storefront sells', () => {
    // Reading the vendor's *tenant* catalog instead would let a counter charge
    // a price no buyer was ever shown, and would need a price-selection rule
    // nobody has written (ADR 0056).
    expect(PublishedOffering.name).toBe('PublishedOffering');
    expect(Object.keys(adapters())).toContain('publishedOfferingRest');
  });
});
