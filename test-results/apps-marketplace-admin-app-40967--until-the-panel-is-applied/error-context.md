# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: apps/marketplace-admin-app-e2e/src/catalog-filtering.mock.spec.ts >> the query the catalog emits >> sends nothing until the panel is applied
- Location: apps/marketplace-admin-app-e2e/src/catalog-filtering.mock.spec.ts:167:7

# Error details

```
Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
Call log:
  - navigating to "/catalog/product-brand", waiting until "load"

```

# Test source

```ts
  1   | import type { Page, Request } from '@playwright/test';
  2   | import {
  3   |   EntityTablePage,
  4   |   type NetworkFixture,
  5   | } from '@r10c/entifix-ts-testing-e2e/playwright';
  6   | import { http, HttpResponse } from 'msw';
  7   | 
  8   | import { BRAND_URL, expect, test } from './support/fixtures';
  9   | 
  10  | /**
  11  |  * What the UI puts *on the wire*, and what it does when the wire answers badly.
  12  |  *
  13  |  * Mock-only by nature, not by convenience: asserting the exact `rsql=`
  14  |  * expression means observing the request, and asserting the error state means
  15  |  * choosing the response — neither is available against a live service.
  16  |  *
  17  |  * The complement of `catalog-filtering.spec.ts`: that file owns the journeys
  18  |  * (what the user sees), this one owns the protocol (what the client emits).
  19  |  */
  20  | 
  21  | /** Records every brand request the page makes, in order. */
  22  | const recordRequests = (page: Page): Request[] => {
  23  |   const requests: Request[] = [];
  24  |   page.on('request', request => {
  25  |     if (request.url().startsWith(BRAND_URL)) requests.push(request);
  26  |   });
  27  |   return requests;
  28  | };
  29  | 
  30  | const lastQuery = (requests: Request[]): URLSearchParams => {
  31  |   const latest = requests[requests.length - 1];
  32  |   if (!latest) throw new Error('no entity request was made');
  33  |   return new URL(latest.url()).searchParams;
  34  | };
  35  | 
  36  | const openBrands = async (page: Page) => {
  37  |   const requests = recordRequests(page);
  38  |   const table = new EntityTablePage(page);
> 39  |   await page.goto('/catalog/product-brand');
      |              ^ Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
  40  |   await table.waitForRows();
  41  |   return { table, requests };
  42  | };
  43  | 
  44  | /** Waits for a request beyond the ones already seen, then reads its query. */
  45  | const nextQuery = async (requests: Request[], before: number) => {
  46  |   await expect
  47  |     .poll(() => requests.length, { message: 'expected a new entity request' })
  48  |     .toBeGreaterThan(before);
  49  |   return lastQuery(requests);
  50  | };
  51  | 
  52  | test.describe('the query the catalog emits', () => {
  53  |   test('sends a substring filter as RSQL', async ({ page }) => {
  54  |     const { table, requests } = await openBrands(page);
  55  |     const before = requests.length;
  56  | 
  57  |     await table.filterBy({ member: 'name', operator: 'like', value: 'Acme' });
  58  | 
  59  |     expect((await nextQuery(requests, before)).get('rsql')).toBe(
  60  |       'name=like=Acme',
  61  |     );
  62  |   });
  63  | 
  64  |   test('quotes a value that carries a space', async ({ page }) => {
  65  |     const { table, requests } = await openBrands(page);
  66  |     const before = requests.length;
  67  | 
  68  |     await table.filterBy({ member: 'name', operator: 'eq', value: 'Acme 1' });
  69  | 
  70  |     // Unquoted, the expression would not survive the tokenizer.
  71  |     expect((await nextQuery(requests, before)).get('rsql')).toBe(
  72  |       "name=='Acme 1'",
  73  |     );
  74  |   });
  75  | 
  76  |   test('joins two rows with and', async ({ page }) => {
  77  |     const { table, requests } = await openBrands(page);
  78  |     const before = requests.length;
  79  | 
  80  |     await table.filterBy(
  81  |       { member: 'name', operator: 'like', value: 'Acme' },
  82  |       { member: 'code', operator: 'like', value: 'brand' },
  83  |     );
  84  | 
  85  |     expect((await nextQuery(requests, before)).get('rsql')).toBe(
  86  |       'name=like=Acme;code=like=brand',
  87  |     );
  88  |   });
  89  | 
  90  |   test('brackets an or group', async ({ page }) => {
  91  |     const { table, requests } = await openBrands(page);
  92  |     const before = requests.length;
  93  | 
  94  |     await table.openFilters();
  95  |     await table.matchAny('or');
  96  |     await table.addFilter({ member: 'name', operator: 'like', value: 'Acme' });
  97  |     await table.addFilter({ member: 'code', operator: 'like', value: 'brand' });
  98  |     await table.applyFilters();
  99  | 
  100 |     // Parenthesized because top-level entries are joined with `;`: an
  101 |     // unbracketed `,` group would change meaning as soon as a second entry
  102 |     // appeared beside it.
  103 |     expect((await nextQuery(requests, before)).get('rsql')).toBe(
  104 |       '(name=like=Acme,code=like=brand)',
  105 |     );
  106 |   });
  107 | 
  108 |   test('sends signed, precedence-ordered sort terms', async ({ page }) => {
  109 |     const { table, requests } = await openBrands(page);
  110 |     const before = requests.length;
  111 | 
  112 |     await table.sortBy(
  113 |       { member: 'name', direction: 'desc' },
  114 |       { member: 'code' },
  115 |     );
  116 | 
  117 |     expect((await nextQuery(requests, before)).get('sort')).toBe('-name,+code');
  118 |   });
  119 | 
  120 |   test('carries filtering, sorting and paging in one request', async ({
  121 |     page,
  122 |   }) => {
  123 |     const { table, requests } = await openBrands(page);
  124 | 
  125 |     await table.filterBy({ member: 'name', operator: 'like', value: 'Acme' });
  126 |     await expect
  127 |       .poll(() => lastQuery(requests).get('rsql'))
  128 |       .toBe('name=like=Acme');
  129 | 
  130 |     const before = requests.length;
  131 |     await table.sortBy({ member: 'name', direction: 'desc' });
  132 | 
  133 |     const query = await nextQuery(requests, before);
  134 |     expect(query.get('rsql')).toBe('name=like=Acme');
  135 |     expect(query.get('sort')).toBe('-name');
  136 |     expect(query.get('page')).toBe('1');
  137 |   });
  138 | 
  139 |   test('drops the filter again on clear', async ({ page }) => {
```