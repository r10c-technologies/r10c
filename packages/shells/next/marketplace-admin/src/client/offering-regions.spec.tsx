import { EntityRepositoryTag } from '@entifix/business';
import { type Entity, type EntityWriter, settled } from '@entifix/core';
import { ReferenceLabelsHost } from '@entifix/next-shell';
import { EntifixQueryProvider } from '@entifix/react-integration';
import { makeInMemoryEntityRepository } from '@entifix/testing-unit';
import {
  ProductOffering,
  ProductOfferingPrice,
  ProductSpecification,
} from '@r10c/business-ts-product-configuration-management';
import { render, screen, waitFor, within } from '@testing-library/react';
import { Context, Effect } from 'effect';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createClientAdapters } from './adapters/create-client-adapters.js';
import {
  productOfferingCrud,
  productOfferingCrudWith,
} from './catalog-crud.js';
import type { MarketplaceAdminAdapters } from './client-types.js';
import { MarketplaceAdminAdaptersProvider } from './marketplace-admin-context/marketplace-admin-context.js';

let slug = 'o-1';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useParams: () => ({ slug }),
  useSearchParams: () => new URLSearchParams(),
}));

const writer = (
  context: Context.Context<EntityRepositoryTag>,
): EntityWriter => {
  const repository = Context.get(context, EntityRepositoryTag);
  return {
    save: entity => Effect.map(repository.save(entity), settled),
    delete: entityOrId =>
      Effect.as(repository.delete(entityOrId), settled(undefined)),
  };
};

const specification = (id: string, media?: ProductSpecification['media']) =>
  Object.assign(new ProductSpecification('P', `Spec ${id}`), {
    id,
    ...(media === undefined ? {} : { media }),
  });
const offering = (id: string, name: string, specificationId: string) =>
  Object.assign(new ProductOffering(name, specificationId), {
    id,
    name,
    specificationId,
  });

const real = createClientAdapters();
const adapters = (): MarketplaceAdminAdapters => {
  const specs = Context.make(
    EntityRepositoryTag,
    makeInMemoryEntityRepository([
      specification('s-1', [
        { url: 'https://media.test/a.png', alt: 'Una taza azul' },
      ]),
      specification('s-2'),
    ] as Entity[]),
  );
  const offerings = Context.make(
    EntityRepositoryTag,
    makeInMemoryEntityRepository([
      offering('o-1', 'Taza', 's-1'),
      offering('o-2', 'Plato', 's-2'),
      offering('o-3', 'Suelta', ''),
    ] as Entity[]),
  );
  const prices = Context.make(
    EntityRepositoryTag,
    makeInMemoryEntityRepository([
      Object.assign(new ProductOfferingPrice('o-1', 4500, 'GTQ'), {
        id: 'p-1',
      }),
    ] as Entity[]),
  );
  return {
    productRest: specs,
    productWriter: writer(specs),
    deviceModelRest: specs,
    deviceModelWriter: writer(specs),
    productBrandRest: specs,
    productBrandWriter: writer(specs),
    productCategoryRest: specs,
    productCategoryWriter: writer(specs),
    productOfferingRest: offerings,
    productOfferingWriter: writer(offerings),
    productOfferingPriceRest: prices,
    productOfferingPriceWriter: writer(prices),
    publishedVendorRest: specs,
    referenceMetadata: real.referenceMetadata,
    catalogMetadata: real.catalogMetadata,
    productBrandUseCases: real.productBrandUseCases,
    deviceModelUseCases: real.deviceModelUseCases,
    productCategoryUseCases: real.productCategoryUseCases,
    productOfferingUseCases: real.productOfferingUseCases,
    productUseCases: real.productUseCases,
  };
};

const renderPage = (page: ReactElement) =>
  render(
    <EntifixQueryProvider>
      <ReferenceLabelsHost registrations={[]}>
        <MarketplaceAdminAdaptersProvider adapters={adapters()}>
          {page}
        </MarketplaceAdminAdaptersProvider>
      </ReferenceLabelsHost>
    </EntifixQueryProvider>,
  );

beforeEach(() => {
  // The images region joins the record's section nav (#597), whose active
  // section is tracked by an observer jsdom does not have.
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe = vi.fn();
      disconnect = vi.fn();
    },
  );
  slug = 'o-1';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the offering list (#558)', () => {
  it('shows each offering’s price and picture, and a dash where there is none', async () => {
    renderPage(<productOfferingCrud.ListPage />);

    await waitFor(() =>
      expect(
        screen.getAllByRole('img', { name: 'Una taza azul' }).length,
      ).toBeGreaterThan(0),
    );
    expect(screen.getAllByText(/45[.,]00/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});

describe('the offering page (#564)', () => {
  it('shows the specification’s pictures and leads to it', async () => {
    renderPage(<productOfferingCrud.SingleViewPage />);

    const images = await screen.findByRole('region', { name: 'Imágenes' });
    await waitFor(() =>
      expect(
        within(images).getByRole('img', { name: 'Una taza azul' }),
      ).toBeInTheDocument(),
    );
    expect(
      within(images).getByRole('link', { name: 'Editar especificación' }),
    ).toHaveAttribute('href', '/es/catalog/product/s-1');
    expect(
      await screen.findByRole('region', { name: 'Precios' }),
    ).toBeInTheDocument();
  });

  it('says so when the specification has no pictures', async () => {
    slug = 'o-2';
    renderPage(<productOfferingCrud.SingleViewPage />);

    expect(
      await screen.findByText('Esta especificación todavía no tiene imágenes.'),
    ).toBeInTheDocument();
  });

  it('offers no specification to edit when none is chosen', async () => {
    slug = 'o-3';
    renderPage(<productOfferingCrud.SingleViewPage />);

    const images = await screen.findByRole('region', { name: 'Imágenes' });
    expect(
      within(images).queryByRole('link', { name: 'Editar especificación' }),
    ).not.toBeInTheDocument();
  });

  it('renders the regions a host adds after its own', async () => {
    const crud = productOfferingCrudWith({
      regions: record => [<p key="host">{`Host region for ${record.name}`}</p>],
    });
    renderPage(<crud.SingleViewPage />);

    expect(await screen.findByText('Host region for Taza')).toBeInTheDocument();
  });
});
