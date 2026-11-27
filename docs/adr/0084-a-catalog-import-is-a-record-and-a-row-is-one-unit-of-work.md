# 84. A catalog import is a record, and a row is one unit

- Status: Proposed
- Date: 2026-11-25
- Revised: 2026-11-26 — a row whose SKU names an offering updates it (§8);
  the import is no longer create-only (§6)
- Area: business
- Read when: bulk-loading records — a row is one claimed unit

## Context

The first customers are small merchants: a hardware store, a phone-accessory
shop, a leather supplier (`verticals-research.md`). Each already has a
catalog of hundreds of products, kept in a spreadsheet. The back office offers
two ways to put one in: the product form, and the guided product setup
(ADR 0045). Both create one product at a time. A demo that starts with typing
three hundred products is a demo that does not happen. Discussion #615 asked
for a bulk import with a report of the rejected rows.

The fleet already has what one product needs, spread over four writes:

- the specification's create, which draws `code` from a per-organization
  counter in the same unit of work (ADR 0079 §1);
- the offering's save, whose `status`, `saleUnit` and stock source are
  server-owned (ADR 0047, ADR 0082 §3);
- the price's save, which carries stored tiers across and checks them
  (ADR 0082 §8);
- the release and publish verbs, each one conditional write, a publication
  announced from the outbox in the same transaction (ADR 0028, ADR 0068).

Calling those four once per row from a loop would leave a sheet half-written
the moment one call failed: a product with no offering, an offering with no
price. A retry would draw a second code for the row whose specification was
already written.

## Decision

1. **The browser parses the sheet, and the service receives rows.**
   `.csv` is read with `papaparse` (which detects the `;` a Spanish-locale
   spreadsheet writes) and `.xlsx` with `read-excel-file`, keeping numbers as
   the text the workbook holds. Both are in the back office's shell
   (`@r10c/shells-next-marketplace-admin`), the composition that picks a
   library, never in a cell or the business package. The file is not uploaded
   or stored. So unlike a payment receipt (ADR 0081 §8) it needs no store and
   no deletion date.

2. **Reading a sheet is one pure function, run on both sides.**
   `readImportSheet`, `toImportRows` and `importRowRefusal` in
   `@r10c/business-ts-product-configuration-management` read headers in
   either locale (accent- and case-blind, ADR 0044), scale money by the
   currency's minor unit as `Intl` knows it, scale quantities by the sale
   unit (ADR 0082 §1), and ask each row what a form save would ask: a
   sellable rule, a known `pricePer`, tiers that step down, `universal`
   alone, an `https` image. The wizard's preview runs them to show each row's
   problem before anything is sent. The use case runs `importRowRefusal`
   again on every row it receives and trusts nothing the browser said.

3. **A name is resolved in the browser, as the form's pickers resolve it.**
   A brand, category or phone model is matched by name against the active
   records of `catalog-reference`, which the back office already reads
   through `/api/marketplace`. The service receives ids and treats them as a
   form save does: as plain ids into another slice's store, which no write
   joins (ADR 0022). A name that matches nothing is that row's
   `importReferenceUnresolved`.

4. **A row is one unit of work, claimed by `<key>:<row>`.**
   `CatalogImportCommands.importRow` writes the specification, its offering
   and its price in one Mongo transaction. The code is drawn from the counter
   the create draws from. For a sheet put on sale, the version is released
   and the offering published in the same unit, with `catalog.published`
   emitted to the outbox. The unit claims `<Idempotency-Key>:<row number>` in
   `command_inbox` and replays the ids it wrote. A failed row leaves nothing
   behind and spends no code. A resubmitted sheet answers each row it already
   wrote and writes the rest.

   The code is part of the content a release hashes and a publication copies
   (ADR 0079 §1). So the domain hands the store a `seal`: it runs inside the
   unit after the code is drawn and answers what to announce. The domain
   decides, and the store numbers.

5. **The import is a record, and the record is the report.** `CatalogImport`
   lives in the `catalog` store. Its id is the request's `Idempotency-Key`,
   and it holds the file's name, the mode, the counts and a `rejections`
   composition of `{ rowNumber, code, column }`. Each `code` is an `errors`
   catalog key, so `@r10c/i18n-check` covers it. It is written once, claimed
   under `catalog-import:<id>`, so two attempts racing on one sheet report one
   outcome. Its routes are reads, and `creatable: false` keeps "New" off its
   list. It is append-only, like a commission entry, so it carries no
   revision.

6. **A row creates unless its SKU names an offering; capped; synchronous.**
   A row with no SKU, or one the catalog does not hold, creates a product
   and keeps its SKU. Such a row is refused `importDuplicate` when its name
   repeats an earlier row without a SKU, or names a specification the catalog
   holds in design or on sale. Which of two same-named products a
   sheet means is not something to guess. The claim is read **before** the
   name check, so a retried sheet is not refused for the products its first
   attempt created. Two imports racing on one new name are not caught, exactly
   as two people creating it through the form are not. A sheet past
   `catalog.importMaxRows` (500, seeded) is refused `importTooLarge` whole,
   before any row is written. Every row is answered in the one request.

7. **The verb is `unbound`, opened by its wizard.**
   `POST /api/catalog-import/import` is the `import` use case on
   `CatalogImport`, `binding: 'unbound'`, with `form: 'catalog-import'`, so
   no generic surface offers it as a button. Its permission,
   `product-configuration-management:catalog-import:import`, is held by
   `admin`, beside `publish`. The wizard (ADR 0045: mode → file → review) is
   guarded by that permission rather than by `write`, because the verb is the
   only route behind it. Its draft holds the parsed rows and the key, never a
   `File` (ADR 0032), so a refreshed tab resumes the review and a resubmit
   resumes the import.

8. **A row whose SKU names an offering updates it.** `ProductOffering.sku`
   is the vendor's own code, unique within the organization's catalog store
   (entifix ADR 0034). A row carrying a SKU the catalog holds changes that
   offering's name, step, minimum and price (amount, currency, price per,
   tiers), and nothing else:

   - **The unit is never changed.** A row whose unit differs is refused
     `saleUnitFixed`: `set-sale-unit` owns it (ADR 0082 §8).
   - **The product's details are the specification's.** A description,
     brand, category, fit or picture cell left empty keeps what the product
     has, and one repeating it passes. One that differs is refused
     `importSpecificationChanged` with its column: a released version is
     changed by revising it (ADR 0079), never from a sheet.
   - **An offering on sale is republished in the same unit**, whatever the
     sheet's mode, checked as `publish` checks it: an active specification
     (`specificationNotActive`), a drawable base (`stockSourceInvalid`) and
     sellable components (`kitInvalid`). A draft stays a draft. The mode
     decides only what a created row becomes.
   - **One unit, claimed by the same key.** `CatalogImportCommands.updateRow`
     writes the offering and its price, each conditional on the revision it
     was read at, with the announcement. If either moved since, nothing is
     written or claimed, and the row is refused `staleRevision`. Its claim
     replays `change: 'update'`, so a resumed sheet counts as its first
     attempt did, in `updatedCount` beside `createdCount`.
   - **A SKU the sheet repeats** is refused `importDuplicate` on every row
     after the first. One row changes one product.

   The preview cannot tell an update from a create: only the catalog knows
   which SKUs it holds. It says how many rows carry one. Two imports creating
   one new SKU at once are caught by the store, as two forms are.

## Consequences

- A merchant's spreadsheet becomes a catalog in one request, as drafts to
  review or on sale at once, and every refused row is listed with the column
  to fix.
- A retry is always safe: a row is all or nothing, and a key replays.
- The shell's bundle carries two parsers, loaded only on the import screen.
- A sheet of SKUs and prices is a price list: re-importing it reprices the
  catalog, and what is on sale is republished at once.
- **Not decided:** variants and kits from a sheet. A variant's axes
  (ADR 0085) and a kit's components (ADR 0086) are set by their own verbs;
  a row creates a plain offering. Remnants as inventory units
  (Discussion #614) would arrive as further columns once their model exists.

## Considered

- **Upload the file and parse it in the service.** That would mean a binary
  route, a parser in a cell, and a file to store and expire, for no gain: the
  preview needs the parse in the browser anyway, and the service re-checks
  every row regardless.
- **One flow per import on the durable engine (ADR 0066).** Rows do not
  depend on one another and touch one store, so there is no saga and no
  compensation. The per-row claim gives what the engine's journal would,
  without a coordinator.
- **One transaction for the whole sheet.** Five hundred products in one
  Mongo transaction exceeds what a transaction should hold, and one bad row
  would refuse the whole sheet. The vendor wants the opposite.
