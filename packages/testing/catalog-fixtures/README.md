# @r10c/testing-catalog-fixtures

The storefront's test catalog: published offerings, brands, categories and
vendors, as JSON in the entity wire shape (`src/data/*.json`).

- The `mock` e2e profile serves the JSON as it is
  (`apps/marketplace-app-e2e/src/support/server-mocks.mjs`).
- `catalogFixtures()` returns one `@entifix/static` repository per set. It
  validates every row against its entity's metadata and every cross-reference
  (`brandId`, `categoryId`, `vendorId`, `parentId`), and throws a
  `RecordValidationError` naming every problem.

The spec pins what the set is for. The journeys also rely on a few facts:

- Nothing sorts by name before "Aurora Desk Lamp", because the home page shows
  six offerings by name.
- Lighting's first page of six, by name and by code, holds the Aurora desk lamp
  and floor lamp.
- `offering-terra-ceramic-mug` is the basket that answers `409 paymentPending`.
- `archive` is the retired category, and `brand-antigua` is the retired brand.
  Nothing is classified under either.

⚠️ `like` does not fold accents, so `q=jarron` misses "Marea Jarrón".

See [DEVELOPING.md → One catalog for every storefront fixture](../../../docs/DEVELOPING.md#one-catalog-for-every-storefront-fixture).
