# 80. A capability register holds one thin entry per use case

- Status: Proposed
- Date: 2026-11-16
- Area: platform
- Read when: adding a use case or publishing to the docs site — the id is a permission shape, and `implemented` must resolve to code

## Context

The repository can answer "which store does this entity live in?" by running a
test. It cannot answer "what can a vendor do today?". That question has three
askers in MVP-3: the docs site, the vertical guides that cite steps, and a
person deciding what to build next. Nothing answers any of them.

What exists, and where it lives:

- **Verbs are declared, and only some are.** The business layer holds 16
  `@useCase()` declarations (a line-start count over `packages/business/ts`).
  Each one derives its permission from `@entity({ domain, key })` plus its own
  `key`, as `<domain>:<entityKey>:<action>`
  (`packages/business/ts/order-management/src/use-cases/cancel-product-order/cancel-product-order.uc.ts:27-48`,
  `permissionForUseCase` at `:64`). Creating, editing and deleting a record is
  CRUD over the entity and has no `@useCase()` at all; neither does the
  storefront checkout, which is a recipe in
  `packages/shells/effect/flow-catalog/src/catalog.ts` (`FLOW_RECIPES`, with
  `checkout`, `cancellation` and `delivery`). A verb may name the recipe it
  starts (`recipe: 'cancellation'`, `recipe: 'delivery'`).
- **The build already reads these from source.**
  `tools/slices/src/source-scan.ts` exports `declaredUseCases()`,
  `declaredEntityResources()` and `barrelReaches()`. They read source rather
  than `Symbol.metadata`, so a class that no barrel exports is still seen. The
  grant table is `ROLE_PERMISSIONS`
  (`packages/business/ts/authz-grants/src/values/role-permissions.ts`), written
  in literals and wildcards. `@r10c/slices` fails a grant that names a verb
  nothing declares.
- **Screens are declared per shell, not in one place.** Each Next shell
  exports a surface list and a nav fragment: `ORDER_SURFACES`,
  `STOCK_SURFACES`, `SALES_SURFACES`, `SETTLEMENT_SURFACES`,
  `FULFILMENT_SURFACES`, `MARKETPLACE_ADMIN_CATALOG_SURFACES` and
  `MARKETPLACE_ADMIN_WIZARD_SURFACES`, plus `*_NAV` sections. Every item
  carries a `permission` and a `workspace` address built by `screenAddress({
type, key })`. The back office concatenates the fragments in
  `apps/back-office-app/src/lib/nav.ts`. The four screen types are entifix's
  `ScreenTypes` (`master`, `operation`, `wizard`, `report`) in
  `@entifix/authz` 0.22.4. Auth and system-management contribute nav sections
  and no surface list.
- **The storefront has no taxonomy.** Its screens are pages in
  `packages/shells/next/marketplace/src/lib/pages/` and the routes under
  `apps/marketplace-app/src/app/[locale]/`. The only single list of them is
  `storePaths` in `packages/shells/next/marketplace/src/lib/routing/paths.ts`.
- **ODA names live in prose.** The capability map in
  `docs/BUSINESS-ARCHITECTURE.md` (§ Capability map) gives each domain its ODA
  analog by hand. Three rows have no ODA component, and the doc says so
  deliberately.
- **Plans name capabilities a third way.** The vertical research uses ids like
  `CAP-ORDER-PAYLINK-01`. That is a third scheme beside permissions and
  screen addresses, and nothing resolves it.

[ADR 0025](0025-where-planning-and-business-knowledge-live.md) gives each kind
of knowledge one home. The contract is `BUSINESS-ARCHITECTURE.md` plus
`tools/slices/`; the plan is an issue; how the business works is Notion. Its
"What may be committed" table predates a docs site. That site would put the
contract in front of four audiences (plan Q24): developers, platform
operators, merchants, and people evaluating the product.

## Decision

### 1. One entry per use case, and the id is a permission's shape

A **use case** is something a named party can do that the system either
checks or plans to check. Each use case has exactly one entry:

| Field         | Type                                                                               | Meaning                                                                                            |
| ------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `id`          | `` `${domain}:${entityKey}:${action}` ``                                           | The use case's name, in the same shape as a permission. Unique across the register.                |
| `oda`         | `string \| null`                                                                   | The ODA component (`TMFC002`) or `null`. Checked against the domain's row (§4).                    |
| `entities`    | `readonly string[]`                                                                | `<domain>:<entityKey>` of every entity the use case reads or writes. The first one is the subject. |
| `permissions` | `readonly string[]`                                                                | Every permission a caller must hold, crossing permissions included.                                |
| `screens`     | `readonly string[]`                                                                | Where a person does it: a workspace address without an id, or `storefront:<pathKey>` (§3).         |
| `status`      | `'implemented' \| 'planned' \| 'in-design'`                                        | Whether code for it exists. It never says when (§5).                                               |
| `verticals`   | `'all' \| readonly ('hardware' \| 'phone-accessories' \| 'shoemaking-supplies')[]` | Which vertical guides may cite it. `all` means a guide for any vertical may.                       |

**The id reuses `<domain>:<entityKey>:<action>`, as Q22 decided.** For a
declared verb the id **is** its permission: `order-management:product-order:cancel`.
For CRUD the action is the CRUD word, so `stock-management:stock-movement:write`
names "record a movement". The domain segment then matches the permission
namespace, the entitlement key and the package name. That is the identity
[ADR 0005](0005-business-domain-decomposition.md) made load-bearing, and the id
inherits it rather than adding a fourth name. Ids like `CAP-ORDER-PAYLINK-01`
are dropped. When the vertical guides are written (plan 3.7), each is mapped to
its Q22 id: `order-management:product-order:set-payment-link`,
`…:attach-payment-evidence` and `…:confirm-payment`
([ADR 0081](0081-an-order-waits-for-a-payment-the-seller-confirms-and-a-receipt-is-a-file.md)),
and `shipping-order-management:shipping-order:record-guide`.

The id is not always a permission someone holds. A flow an anonymous buyer
starts has no session permission. The storefront checkout runs behind the
crossing permission `order-management:product-order:write`, which no role
holds. Such a use case is named for the record it opens and the recipe that
opens it: `order-management:checkout-group:checkout`. §2 says what such an id
resolves to.

**Thin is the rule, and it is enforced by what is absent.** An entry has no
description, steps, copy, rationale, owner, dates or issue numbers. A
description belongs in the entity's or verb's catalog copy, which the site
reads through `labelKey`. Steps belong in a guide. Rationale belongs in an
ADR. Dates belong in the milestone. Each of those already has a home that is
checked or meant to be edited by people. An entry that grows a prose field
becomes the second copy ADR 0025 exists to prevent.

### 2. What verifies it: `implemented` resolves to code, and the other two must not

The register lives in **`tools/capabilities/`**, an Nx project
`@r10c/capabilities` tagged like `@r10c/slices` (`layer:app`, `scope:shared`,
`type:testing`). Entries sit one file per domain
(`src/capabilities/<domain>.capabilities.ts`), the way slices sit in
`src/slices/*.slice.ts`. The checks live in `capabilities.spec.ts`, which
reuses `@r10c/slices`'s source scan rather than writing a second one. Its
`pnpm nx test` runs in Change Validation like every other test target, and
none of it reads the Nx cache
([ADR 0074](0074-change-validation-and-the-cache-it-may-trust.md)).

**An `implemented` entry must resolve on every field:**

- **The id resolves to exactly one of three kinds of code.** For a **verb**, a
  `@useCase()` on that entity with that `key`, reachable from its package's
  barrel (`barrelReaches`). For **CRUD**, the entity exists, its slice's
  `exposedAPIs` serves its base path, and the action is `read`, `write` or
  `delete`. For a **recipe**, a key of `FLOW_RECIPES` equal to the action.
- **Every `entities` member** is a declared `@entity()`
  (`declaredEntityResources()`).
- **Every `permissions` member** is granted to some role through `can` over
  `ROLE_PERMISSIONS`, wildcards included, or is an entry of
  `SERVICE_CROSSING_PERMISSIONS`.
- **Every `screens` member** is a workspace address in the composed back-office
  `NAV`, or a key of `storePaths` (§3).
- **`oda`** equals the value the domain table gives (§4).

**A `planned` or `in-design` entry must not resolve.** If its id resolves to
any kind of code, the build fails and names the entry: the code landed and the
entry was not promoted. Its `entities`, `permissions` and `screens` may name
things that do not exist yet. That is the point of planning, as it is for a
`planned` slice ([ADR 0020](0020-stores-and-slices.md)).

**Coverage runs the other way too.** Every `@useCase()` and every
`FLOW_RECIPES` key must be the id of some `implemented` entry. A verb with no
entry fails the build, so the register cannot fall behind the code. CRUD is
not enumerated: not every served entity is a use case worth naming (a
`Reservation` read, for one). A CRUD entry is written when a guide or the site
needs to cite it.

### 3. Screens come from the shells' taxonomy, and the storefront from its paths

`screens` are not declared anywhere new, as Q22 decided. The verifier imports
the shells' nav fragments as `apps/back-office-app/src/lib/nav.ts` composes
them, collects every item's `workspace` address with the id removed
(`operation:product-order`, `wizard:product-setup`), and resolves against that
set. A verb is done on its entity's record screen, so a verb's `screens` names
the address of its entity's surface.

The verifier imports each shell's `/server` entry point, as
`apps/back-office-app/src/lib/nav.ts` does. That adds the eight
`@r10c/shells-next-*` packages to the tool's dev dependencies, as
`@r10c/slices` already lists the Effect shells. It derives no address by
regex. The slices scan reads source only because metadata hides unexported
classes, and an exported `NAV` has no such blind spot.

**The storefront has no `ScreenType`, and none is added for it.** The four
types are entifix's back-office model (entifix ADR 0007), and the storefront
is not a back office. A storefront screen is named `storefront:<key>`, where
`<key>` is a key of `storePaths` (`storefront:cart`, `storefront:offering`).
`storePaths` is already the one list of its internal paths, so it is the
storefront's taxonomy in all but name.

The landing page of [ADR 0077](0077-the-landing-page-and-regions-composed-across-slice-shells.md)
has no screen type and writes nothing, so no entry names it.

### 4. ODA comes from the domain, once

`oda` is per entry because a few use cases sit in a different component from
the rest of their domain. A refund is Payment Management, but publication is
the catalog's published view. The default still comes from the domain. A
table in `tools/capabilities` maps each domain to its ODA analog. An entry's
`oda` must equal its domain's value unless the entry names an `odaOverride`
reason. `null` is legal and means no ODA component was found: Sales and Stock
today, for the reasons the capability map records.

That table is the same fact as the capability map in `BUSINESS-ARCHITECTURE.md`.
Two hand-written copies would drift, so the map becomes a generated block
(`<!-- docs:begin capability-map -->`) rendered by `tools/sync-docs.mjs` from
the table, like the store register. The map's own `Status` column (`entities`,
`in use`) is dropped in the same change. It meant something different from
this register's `status`, and the register now answers "what is built" per use
case. `@r10c/docs-check`'s assertions on the map are edited to match.

### 5. `status` says whether code exists, never when

The three values mean:

- **`implemented`** — the id resolves (§2).
- **`planned`** — the use case is committed to by a milestone and is not built.
- **`in-design`** — it is being designed and may change shape or be dropped.
  Discussions-level ideas (plan §4) are not entries at all.

A status is a fact about the tree, so CI can check it. Dates, assignees,
progress and the issue that builds an entry are not facts about the tree.
They stay in the issue and the milestone (ADR 0025's fourth artifact). The
site shows `planned` and `in-design` as such and links nowhere: whoever needs
the date opens the milestone.

⚠️ **`in-design` is also a specification's lifecycle state**
([ADR 0079](0079-a-published-specification-is-versioned-and-a-save-names-the-revision-it-read.md) §1).
The two never meet in one value: this one is the type of the register's
`status` field, and that one is a member on a specification record. The word
is kept because both mean "not released, may still change".

### 6. Verticals are a closed set of three, and the list is never empty

`verticals` is closed, like `SalesChannelTypes`: `hardware`,
`phone-accessories` and `shoemaking-supplies`. Those are the three guides of
plan 3.7. A guide's `:use-case[id]` directive fails the build when the id is
unknown, and also when the entry's `verticals` neither is `all` nor includes
that guide's vertical. An empty list is refused: a use case no vertical may
cite is written `all` or not written at all. A fourth vertical is a one-line
edit to the set plus a guide.

### 7. The site generates its core from the register and writes none of it

The docs site (plan 3.4) renders one page per entry. The fields come from the
register. The title and description come from the catalog copy behind the
verb's or entity's `labelKey`, in both locales. The four audience entry points
(Q24) filter the same entries: `planned` and `in-design` are shown to
evaluators and merchants as such, and permissions and crossings to developers
and operators. Nothing on a use-case page is written by hand, so it cannot
disagree with the register.

### 8. What the site may publish, and what stays in Notion (revises ADR 0025)

The register sits in the repository, and the repository is public until it is
not ([ADR 0025](0025-where-planning-and-business-knowledge-live.md), "What may
be committed"). Everything in an entry is therefore public the moment it is
committed, whatever access the site's r10c instance has (Q23 restricts that
instance from day one). The site never publishes anything the repository
could not hold.

| The register and the site may carry                                                                | Notion only                                                                             |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Use-case ids, ODA names, entities, permissions, screens, status                                    | What a merchant interview found, who said it, and their volumes, prices or margins      |
| The three verticals as product scope, and guides written against ids                               | Named pilot or prospective merchants, and any customer conversation (plan 8.2)          |
| Public law and mechanism: tax regimes, document types, how a payment link or a courier guide works | Commission rates, payout terms, and any provider's or courier's rates or contract terms |
| The dictionary mechanism: keys, `other`, a tracking-URL template's shape (Q18)                     | Which payment-link providers and couriers exist for us, by name, and on what terms      |
| That something is `planned` or `in-design`                                                         | Why it was ranked where it was, when that reason is a customer                          |

The test stays ADR 0025's: not "is this secret" but "is this ours". The new
row is about the payment-link providers and couriers of
[ADR 0081](0081-an-order-waits-for-a-payment-the-seller-confirms-and-a-receipt-is-a-file.md)
§10. Each name is public by nature, but the list of names is our position on
whom we work with. So the repository's seed carries `other` alone. Names, with
their terms, stay in Notion, and reach an environment as that environment's
configuration rows, set outside the repository (plan 5.7). No rate, account,
contact or contract status is ever committed.

**Four artifacts still, not five.** The register is part of the third
artifact, the contract. ADR 0025's table row becomes
"`BUSINESS-ARCHITECTURE.md` + `tools/slices/` + `tools/capabilities/`". It
answers "what the contract is" for use cases as `tools/slices/` answers it for
stores.

## Consequences

- **A new verb costs one entry more.** The coverage check makes forgetting it
  a red build rather than a stale page. This is a toll on the path plan 1.18
  measures, and it is counted there.
- **The capability map stops being hand-written.** One table feeds the map
  and the register's ODA check.
- **The storefront gains a name for its screens** without gaining a screen
  type. A `storePaths` rename now fails the register as well as the links.
- **The checkout becomes nameable.** Its id is a recipe, the one use case in
  the fleet whose caller holds no permission.
- **`planned` work becomes visible to evaluators.** The repository's exposure
  rule already allowed milestone titles, so the change is that it is
  displayed, not that it is disclosed.
- **The router grows by two index lines and one name.** `CLAUDE.md`'s
  ceiling rises from 40,000 to 42,000 bytes, with this record and ADR 0081 as
  the reason written beside it in `docs.spec.ts`.
- **Revises in place** [ADR 0025](0025-where-planning-and-business-knowledge-live.md)
  (the contract artifact gains `tools/capabilities/`, the docs site publishes
  nothing the repository could not hold, and provider and courier names stay
  out of the repository). It supersedes nothing.

## Decided with Herber, 2026-11-17

The draft raised nine conflicts. Herber accepted every recommendation, and
each one is folded into the text above:

1. Storefront screens are named from `storePaths` as `storefront:<key>`, and
   no fifth screen type is added (§3).
2. The storefront checkout's id is `order-management:checkout-group:checkout`
   and resolves to its flow recipe (§1, §2).
3. Entries are required for the 16 `@useCase()` verbs and the three
   `FLOW_RECIPES` only. A CRUD entry is written when something cites it (§2).
4. The research's `CAP-…-01` ids are dropped. Each is mapped to a Q22 id when
   the guides are written (§1).
5. The capability map's ODA column is generated from the register's domain
   table, and the map's own `Status` column is dropped (§4).
6. `in-design` keeps its name beside ADR 0079's lifecycle state (§5).
7. Vertical slugs are English (`hardware`, `phone-accessories`,
   `shoemaking-supplies`), with Spanish names in the `es` catalog (§6).
8. `CLAUDE.md`'s "Four artifacts" rule names `tools/capabilities/` (§8). The
   router's ceiling in `tools/docs/src/docs.spec.ts` rises from 40,000 to
   42,000 bytes, with this record and ADR 0081 as the stated reason.
9. The verifier imports the shells' `/server` nav fragments, as the back
   office does, and derives no address by regex (§3).

## Trigger

The record moves to Accepted when `tools/capabilities` fails the build on an
`implemented` entry whose id resolves to nothing and on a `@useCase()` with no
entry (#640). It also requires the docs site to render one page per entry from
the register (plan 3.4).
