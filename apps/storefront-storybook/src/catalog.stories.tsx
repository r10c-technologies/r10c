import type { EntityRepository } from '@entifix/business';
import type { Entity } from '@entifix/core';
import { Grid } from '@entifix/react-controls/primitives';
import type { ProductBrand } from '@r10c/business-ts-catalog-reference';
import type { PublishedOffering } from '@r10c/business-ts-marketplace-catalog';
import { catalogFixtures } from '@r10c/testing-catalog-fixtures';
import { ProductCard } from '@r10c/utils-react-ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Effect } from 'effect';

/**
 * The card over the shared fixtures, read through the same static
 * repositories e2e serves. The mapping below is the binding #339 moves into
 * the catalog cell; until then it lives here, in plain sight.
 */
const fixtures = catalogFixtures();

const everything = <T extends Entity>(repository: EntityRepository) =>
  Effect.runSync(repository.load<T>({ page: 1, pageSize: 100 })).items;

const brandName = new Map(
  everything<ProductBrand>(fixtures.brands).map(brand => [
    String(brand.id),
    brand.name,
  ]),
);

const price = (offering: PublishedOffering) =>
  new Intl.NumberFormat('es-GT', {
    style: 'currency',
    currency: offering.currency,
  }).format(offering.amount / 100);

function OfferingTile({ offering }: { readonly offering: PublishedOffering }) {
  return (
    <ProductCard
      title={offering.name}
      price={price(offering)}
      brand={
        offering.brandId === undefined
          ? undefined
          : brandName.get(offering.brandId)
      }
      description={offering.description}
      media={offering.media?.[0]}
      availability={offering.availableHint ? 'Disponible' : 'Agotado'}
      cta={
        <a className="text-primary underline" href={`#${offering.offeringId}`}>
          Ver producto
        </a>
      }
    />
  );
}

function Catalog({ offset, count }: { offset: number; count: number }) {
  const offerings = everything<PublishedOffering>(fixtures.offerings).slice(
    offset,
    offset + count,
  );
  return (
    <div style={{ width: 'min(72rem, 100vw - 2rem)' }}>
      <Grid min="16rem" gap="l">
        {offerings.map(offering => (
          <OfferingTile key={offering.offeringId} offering={offering} />
        ))}
      </Grid>
    </div>
  );
}

const meta = {
  title: 'Storefront/Catalog',
  component: Catalog,
  parameters: { layout: 'padded' },
  args: { offset: 0, count: 12 },
} satisfies Meta<typeof Catalog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The first page of the fixtures, in stored order. */
export const FirstPage: Story = {};

/** Every offering: both currencies, out of stock, no brand, no media. */
export const Everything: Story = { args: { count: 100 } };
