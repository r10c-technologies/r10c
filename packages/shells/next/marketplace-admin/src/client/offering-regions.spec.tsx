import { ReferenceLabelsHost } from '@entifix/next-shell';
import { EntifixQueryProvider } from '@entifix/react-integration';
import {
  ProductOffering,
  ProductOfferingPrice,
  ProductSpecification,
} from '@r10c/business-ts-product-configuration-management';
import { inMemoryEntity } from '@r10c/testing-cells/writer';
import { render, screen, waitFor, within } from '@testing-library/react';
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

const adapters = (): MarketplaceAdminAdapters => {
  const specs = inMemoryEntity([
    specification('s-1', [
      { url: 'https://media.test/a.png', alt: 'Una taza azul' },
    ]),
    specification('s-2'),
  ]);
  const offerings = inMemoryEntity([
    offering('o-1', 'Taza', 's-1'),
    offering('o-2', 'Plato', 's-2'),
    offering('o-3', 'Suelta', ''),
  ]);
  const prices = inMemoryEntity([
    Object.assign(new ProductOfferingPrice('o-1', 4500, 'GTQ'), {
      id: 'p-1',
    }),
    // Q7.50 the hundred (ADR 0082 §5).
    Object.assign(new ProductOfferingPrice('o-2', 750, 'GTQ'), {
      id: 'p-2',
      pricePer: 100,
    }),
  ]);
  return {
    ...createClientAdapters(),
    productRest: specs.rest,
    productWriter: specs.writer,
    productOfferingRest: offerings.rest,
    productOfferingWriter: offerings.writer,
    productOfferingPriceRest: prices.rest,
    productOfferingPriceWriter: prices.writer,
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

  it('says what a price quoted per hundred buys', async () => {
    renderPage(<productOfferingCrud.ListPage />);

    await waitFor(() =>
      expect(
        // The amount is `Money`'s own element; the cell reads as one phrase.
        screen.getAllByText(
          (_, element) =>
            element?.tagName === 'SPAN' &&
            /7[.,]50 por 100$/.test(element.textContent),
        ).length,
      ).toBeGreaterThan(0),
    );
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
