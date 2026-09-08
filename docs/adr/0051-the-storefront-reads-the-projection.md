# 51. The storefront reads the projection

- Status: Accepted
- Date: 2026-09-08
- Area: frontend
- Read when: the storefront reads or renders catalog data — nothing is enumerated at build time, and a failed read renders an empty catalog and logs

## Context

M1's chain is: author a `ProductOffering` → publish it → emit
`catalog.published` → project it → **the storefront reads it** → delete the
fixture. ADR 0047 built the first two links, ADR 0048 the next two, ADR 0049
widened the payload until a card could be drawn from it, and ADR 0050 made the
projection rebuildable so a fresh lab is not empty.

Through all of that the storefront read **fixtures**. `queries.ts` built three
`createFixtureRepositoryContext` calls over records checked into the shell, so
`published-catalog` filled correctly on every publication and no visitor could
see it. The file's own comment promised the swap would be small — _"when
marketplace-service lands, only the three `createFixtureRepositoryContext` calls
below change"_ — and that was true of two of the three.

It is two swaps, not one. `ProductBrand` and `ProductCategory` live in
`catalog-reference`, which marketplace-service already serves, and they swap
where they stand. The third does not: the storefront read `ProductSpecification`
and has to read **`PublishedOffering`**, a different entity in a different store
with a different address — which moves the card, the grid, the cart's key, every
query and the product URL with it.

### One of the issue's own findings was wrong

[#147](https://github.com/r10c-technologies/r10c/issues/147) reported that
`ProductCategory.code` is not `filterable`, so resolving a category slug against
the real service would answer `400`. It is filterable:
`describe-entity-columns.ts` defaults **both** flags to `isScalar`, and `code` is
a `string`. The entity needs no change and there is no `400` to avoid. Recorded
because the opposite belief would have produced a one-line "fix" whose passing
proved nothing.

### Three things the issue did not mention, and each forced a decision

**`ConfigurationClientRestClient` could not be the swap as it stood.** It fetches
the relative `/api/config`, which Node rejects server-side for want of an origin,
and it sends no headers — while config-service's `/api/config/:service` is gated
on the shared fleet token, because it serves real connection strings and cannot
redact them. marketplace-app also has no `/api/config` route, and adding one
would have the app fetch itself while prerendering itself.

**`next build` reached the network.** Home is prerendered per locale and
`generateStaticParams` enumerated every product, so with REST underneath both
became build-time fetches of a service no build machine has.

**The mock e2e profile could not see the traffic.** Every suite in the repo stubs
through `page.route()`, which observes the _browser_. The storefront is React
server components: its reads never leave the Next process.

## Decision

### One backend, resolved server-side, with no proxy

`marketplace-service-domain` is seeded for `marketplace-app` and read **directly
from config-service** with `X-Service-Token`, through the same
`ConfigurationClientRestClient` the browser uses — which gains a `headers`
option, and nothing else.

There is deliberately no same-origin proxy and no `rewriteServiceDomains` step.
That machinery exists so a real backend address never reaches a browser and so a
request carries the `httpOnly` session cookie; neither applies to a fetch made by
the server itself, and the storefront holds no session at all. Reads on
marketplace-service are unauthenticated by design — a storefront that needed a
token to show a catalog could not be cached, and could not serve anonymous
traffic.

The projection and the browse vocabulary are both marketplace-service's, so
there is **one** configuration key and one adapter set, not two.

### The address is the offering id

`/p/<offeringId>`, replacing `/p/<code>`. ADR 0049 anticipated this and the
reason is now load-bearing rather than theoretical: an offering and a
specification are 1:N by construction, so two vendors publishing against one
specification carry the same `code` — and a lookup by code returns the _first_
match rather than failing, which makes the second vendor's listing silently
unreachable instead of visibly broken. `code` is still rendered, because it is
the reference a buyer quotes back; it is simply not an identity.

The cart's cookie is keyed the same way, for the same reason: keyed on `code`,
two vendors' items would share one line.

⚠️ **The lookup is `load` with a filter, never `get`.** ADR 0049's rule, and it
binds here: `get` answers an absent row with `EntifixConnError`, the same class a
driver failure raises, so a 404 page and a datastore outage would be one code
path — every visitor told the product does not exist for the duration of an
incident. `offeringId` is declared `filterable` for exactly this read.

The one place a filtered lookup is not available is `brandId`/`categoryId`:
`id` is the single member that is neither `sortable` nor `filterable` by default,
so it cannot be queried at all. Those resolve out of the loaded vocabulary
instead — bounded by construction, because a marketplace _merges_ its browse
tree and `catalog-reference` is operator-authored — and a miss stays `undefined`,
since nothing enforces a reference across a store boundary.

### A read that fails renders an empty catalog, and says so in the log

Every exported query catches, logs and answers an empty page. Two reasons, and
the second is the one that decided it: a storefront that answers `500` because
one backend blinked is worse than one that renders its own "nothing here yet"
copy over an intact page — and `next build` prerenders, so a throw would make the
build depend on a running fleet.

⚠️ **The cost is stated rather than hidden: empty and broken render
identically.** The log is the only thing that separates them, which is why this
must not spread to anything that writes, and why the live-profile storefront e2e
[#148](https://github.com/r10c-technologies/r10c/issues/148) adds is the check
that will actually assert real data.

### Nothing is enumerated at build time, and the home page stopped being either

`generateStaticParams` returns `[]` on the offering route and on the home page.
The `[locale]` layout's copy, which used to prerender `/es` and `/en`, is
**deleted**.

⚠️ **This is correctness, not a lost optimization.** A build machine has no
fleet, so what a build-time render of the home page bakes in is an _empty
catalog_, which `revalidate` then serves to the first visitor of each locale
after every deploy. A page rendered from data the builder could not read is not a
warm cache; it is a wrong answer with a TTL. It was measured: the four storefront
e2e journeys failed against a freshly built app for exactly this reason, while
the offering page — never enumerated — rendered correctly.

⚠️ **Empty and absent are different, and the difference is which routes it
reaches.** `[]` keeps a segment in Next's _generated_ mode, which is what makes
an on-demand render cached rather than merely dynamic — so home needs it, and
without it every visit re-renders. But a `generateStaticParams` on the **layout**
governs every descendant, and `/search` and `/cart` read `searchParams` and
`cookies()`: as static candidates they answered `500 DYNAMIC_SERVER_USAGE`.
Hence one empty copy scoped to the home page and none on the layout. The build
output is the check — `● /[locale]`, `● /[locale]/p/[offeringId]`, and `ƒ` for
`/search`, `/cart` and `/c/[category]`.

Every page is therefore rendered on its first request and cached from there. What
the `[locale]` segment buys is unchanged and was never about the build: the
locale is a route parameter rather than a header, which is what makes these pages
cacheable at all, where the back offices' `getRequestLocale()` forces every
render to be dynamic.

`revalidate` drops from an hour to **60s**. The interval is the window in which a
vendor's publication is invisible, and publishing is a button a vendor presses
and then goes looking for the result; an hour of nothing reads as a broken
feature.

### The mock profile fakes at the transport boundary, inside the Next process

`next start` runs under `node --import ./src/support/server-mocks.mjs`, which
installs msw with the **same** `entityBackendHandlers` and `configurationHandler`
the back-office suite already uses. So the fake is still at the transport
boundary and the _production_ query pipeline still runs
(`parseLoadRequestParams → loadUCFactory → makeMongoRepository → fake driver`) —
`mock` and `live` go on agreeing about filtering, sorting, paging and the `400`
the metadata allowlist produces. Nothing in the application bundle knows it
exists.

Three mechanics worth not rediscovering.

⚠️ **Order is the mechanism.** `--import` runs before Next's entry, so Next's
cached-fetch wrapper wraps the patched `fetch`. Register after Next boots and the
interception is invisible.

⚠️ **`NODE_OPTIONS` on a bare `node`, and it must be all three of those
words.** `NODE_OPTIONS` rather than a command-line `--import`, because Next
forks render workers and a parent's flag does not reach them — some requests are
intercepted and some are not, which surfaces as two or three flaky specs rather
than as a broken suite. `node` rather than `pnpm exec`, because `NODE_OPTIONS`
reaches pnpm too and the preload's resolver hook runs while pnpm is still
loading `.pnpmfile.mjs`, failing the launch before Next is reached. And
assigning it at all is what **clears** `nx.json`'s
`--conditions=@r10c/source`, which every `e2e` target sets so a spec resolves
workspace packages to source: inherited by the preload it makes a business
package resolve to `src`, where the first `@entity()` decorator is a
`SyntaxError: Invalid or unexpected token` — Node strips types, it does not
transform them — and the server never starts. `next start` serves a build that
already inlined everything, so it needs that condition for nothing. All three
were measured; the last one only in CI, after the suite had gone green
locally.

⚠️ **The preload needs a resolver hook at all**, because every module in this
workspace writes extensionless relative imports and Node's ESM resolver requires
an extension — every other consumer (webpack, swc, Turbopack, vite) supplies one.
`.ts` is in its list because `@r10c/entifix-ts-testing-e2e` publishes TypeScript
source: it is `type:testing` and has no build target. Node 26 strips the types
itself, which works only because nothing on that path uses a decorator — and the
entity classes therefore have to come from their `dist`, which is the second
reason the source condition must be off.

### The card renders the whole snapshot

Price and availability, which ADR 0049 put on the projection precisely so a card
could be drawn without reading tenant storage, and which nothing had read.
`amount` is in **minor units**, so the conversion lives in one `formatMoney`
rather than at each render site, and `Intl` decides the symbol and the
separators from the locale — `1999` GTQ is `19,99 GTQ` in Spanish and
`GTQ 19.99` in English, neither of which belongs in a template literal. An
unrecognised currency falls back to the bare amount rather than throwing inside a
render.

⚠️ One correction rides along: the card rendered **`brandId`** where a brand name
belongs — a raw id in the tile, which read as a brand only because the fixtures
were named to look like one. The grid resolves the vocabulary once per page and
hands each card a name; a dangling reference renders nothing.

## Consequences

- **The storefront shows what a vendor published**, which is the last link of
  M1's chain and what [#148](https://github.com/r10c-technologies/r10c/issues/148)
  needed before it could delete the fixture repository. It has: the three fixture
  modules are gone.
- **`next build` is hermetic**, and stays that way: it reaches no service, which
  is what lets CI build the app and the e2e build its own artifact.
- ⚠️ **A backend outage looks like an empty catalog.** Stated above. The remedy
  is the live e2e, not a second rendering path.
- ⚠️ **The first visitor of each locale pays a render.** Roughly the cost of one
  service round trip, once per locale per deploy, and the alternative was serving
  them a page built from data the builder could not read.
- **A publication is visible within a minute**, not an hour.
- ⚠️ **A missing product or category answers `200`, not `404`** — the not-found
  UI renders, but the status does not follow it. Found during this record's live
  pass and **not introduced by it**: `CategoryPage` awaited a lookup and called
  `notFound()` before this change too, on a route that is fully dynamic, and it
  behaves identically. `notFound()` raised from inside a `layer:shell` package
  reaches Next's boundary — the page renders correctly — without reaching its
  status; the app's own `requireLocale` still answers `404`, so the mechanism is
  the package boundary rather than the call. It matters for a public storefront,
  where a crawler will index a not-found page as a real one, and it is left
  alone here because the fix belongs to whatever explains that asymmetry rather
  than to the entity swap.
- **`fixture-repository.ts` was left imported by nothing but its own spec**, and
  [#148](https://github.com/r10c-technologies/r10c/issues/148) deleted both.
  `fixtures.ts` went with this record, because nothing referenced it and the
  package is gated at 100%. The layering claim the fixture was written to
  prove — one use case, two transports, injected at the composition root — did
  not need moving anywhere: `queries.spec.ts` runs the **real** use case over
  the **real** REST adapters against msw, which proves it against the transport
  the app actually ships rather than against a second in-memory one.

  ⚠️ What #148 did have to add is a **live profile**, because deleting the
  fixtures was otherwise unfalsifiable here. Every storefront read happens in a
  server component, so the `mock` profile fakes marketplace-service inside the
  Next process — a storefront wired to nothing passes all of it, before and
  after. `storefront.live.spec.ts` walks the journeys against a seeded fleet and
  asks marketplace-service directly whether `published-catalog` is filled before
  it opens a page, because the read path above never rejects and an empty
  projection is indistinguishable from a finished, quiet catalog. Its one
  concession is to the `200` recorded three bullets up: an unpublished
  offering's address is asserted for the **absence of the product**, never for a
  status, since asserting `404` would fail a page behaving exactly as this
  record says it does and asserting `200` would pin the defect in place.

- **The register is untouched.** No new store, no new event, no new route, no
  slice promotion — marketplace-service already owned and served both stores;
  what changed is that something reads them.
