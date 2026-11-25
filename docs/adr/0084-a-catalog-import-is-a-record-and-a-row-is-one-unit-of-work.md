# 84. A catalog import is a record, and a row is one unit

- Status: Proposed
- Date: 2026-11-25
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

6. **Create-only, capped, and synchronous.** A row whose name repeats an
   earlier row, or names a specification the catalog holds in design or on
   sale, is refused `importDuplicate`. Which of two same-named products a
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

## Consequences

- A merchant's spreadsheet becomes a catalog in one request, as drafts to
  review or on sale at once, and every refused row is listed with the column
  to fix.
- A retry is always safe: a row is all or nothing, and a key replays.
- The shell's bundle carries two parsers, loaded only on the import screen.
- **Not decided:** updating products from a sheet. An upsert needs a key a
  vendor controls (a SKU), and the catalog has none. Recorded as a Discussion
  rather than built half-way. Remnants as inventory units (Discussion #614)
  and kits (#616) would arrive as further columns once their models exist.

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
