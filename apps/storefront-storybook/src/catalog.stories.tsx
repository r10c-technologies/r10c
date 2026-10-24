import type { EntityRepository } from '@entifix/business';
import type { Entity } from '@entifix/core';
import { Grid } from '@entifix/react-controls/primitives';
import type { ProductBrand } from '@r10c/business-ts-catalog-reference';
import type { PublishedOffering } from '@r10c/business-ts-marketplace-catalog';
import { offeringCard } from '@r10c/implementation-marketplace-catalog-next';
import { catalogFixtures } from '@r10c/testing-catalog-fixtures';
import { ProductCard } from '@r10c/utils-react-ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Effect } from 'effect';

/**
 * The card over the shared fixtures, read through the same static
 * repositories e2e serves, and bound by the catalog cell's `offeringCard`: the
 * mapping the storefront ships, not a copy of it.
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

function OfferingTile({ offering }: { readonly offering: PublishedOffering }) {
  return (
    <ProductCard
      {...offeringCard(offering, {
        locale: 'es',
        brandName: id => brandName.get(id),
        labels: { available: 'Disponible', unavailable: 'Agotado' },
      })}
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
