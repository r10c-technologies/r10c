# 33. The screen taxonomy: Definiciones, Operaciones, Asistentes, Consultas

- Status: Accepted
- Date: 2026-09-01

## Context

The back office has one tier of navigation and no rule for what shape a new
screen takes. Today that is invisible, because every screen it serves is the
same shape — a generated list plus a generated single-record page, three of them
in the catalog, one in system management, one in identity. ADR 0022 fixes 11
domains and 28 entities, and the milestones ahead add screens that are not that
shape at all: an order has a lifecycle and domain verbs, vendor onboarding spans
several records and then ends, a commission report has no record to edit.

Without a taxonomy each of those is designed on its own and the sidebar grows by
accretion. With one, `makeEntityCrud` covers a named type rather than covering
"the screens we happened to build first", and the ones it cannot generate are
identifiable in advance instead of discovered when the generator does not fit.

### What exists

`GuardedNavSection` is `{ title?, items }`, and the three contributed lists are
grouped by **domain**: `Catálogo` from the host, `Sistema` from
`shells-next-system-management`, `Identidad` and `Cuenta` from
`shells-next-auth`. The grouping is real but unnamed — nothing distinguishes
`Cuenta`, which is the signed-in person's own account, from `Catálogo`, which is
operator-authored master data.

### Prior art

SAP Fiori names the same distinctions as **floorplans**: List Report, Worklist,
Object Page, Overview Page, Analytical List Page, Wizard, Initial Page. Two
findings carried forward:

- Every floorplan is generated from metadata **except the wizard and the initial
  page**. Independent confirmation of the split this repo already made — the
  catalog generator is achievable, the wizard is hand-built by design.
- **Worklist ≠ List Report.** "Items I must act on" is a different thing from
  "all items". Whether that is a type is decided below.

## Decision

### Four types, and the rule that keeps them four

| Type             | The record came from | Lifecycle | The screen's verbs   | Examples                                       |
| ---------------- | -------------------- | --------- | -------------------- | ---------------------------------------------- |
| **Definiciones** | _you_ authored it    | none      | CRUD                 | brand, category, courier, tipo de DTE, channel |
| **Operaciones**  | a _process_ made it  | yes       | domain verbs         | order, payment, settlement run, reservation    |
| **Asistentes**   | guided, multi-step   | ends      | next / back / finish | vendor onboarding, publish an offering         |
| **Consultas**    | nothing — aggregate  | n/a       | read only            | commission reports, settlement summaries       |

The corollary that keeps the taxonomy from dissolving: **"publish" is an action
on a Definiciones screen, not a fourth type.** Otherwise every entity that grows
a verb migrates to Operaciones, and since ADR 0026 gave every entity a way to
declare verbs, that is all of them.

### `Definiciones`, not `Maestros` and not `Catálogos`

`Catálogos` is out on a collision: "catálogo" already means the product catalog
here, and a GT operator reading _Catálogos → Marcas_ cannot tell whether that is
master data or the storefront. `Referencias` is out on the same kind of
collision, found while writing this: `shell:storefront.category.sortByCode`
already renders "Referencia" for a product's code.

`Maestros` is the standard LatAm ERP word — SAP, Odoo and Contpaqi all ship
"datos maestros" — and was this record's first proposal. It is rejected because
the bare plural needs the ERP background to parse: _Maestros_ has no object in
it, and an operator who has not used an ERP reads it as a word about people.
`Datos maestros` fixes that and is the longest label in a sidebar that also
collapses to icons.

**Definiciones** states the actual rule — you define the thing that other
screens reference — and needs no prior vocabulary. It also makes all four names
plain nouns of the same register, where `Maestros` would have been one jargon
term beside three ordinary ones.

The cost, recorded: an operator arriving from an ERP is looking for `Maestros`
and will not find the word. The command palette (#112) is where a synonym can be
made to resolve, and that is the cheap place for it — a nav heading has room for
one name.

### The identifiers are English; the copy is Spanish

```ts
export const ScreenTypes = ['master', 'operation', 'wizard', 'report'] as const;
```

Identifiers stay English because every other identifier in this repo is, and
`maestro` / `operacion` would be the only Spanish ones. Two of the four obvious
English words were unusable: **`query`** collides three ways here (RSQL, TanStack
Query, and `filterable`/`queryable` metadata) and **`assistant`** reads as an AI
agent. So the enum takes `report` and `wizard`, which are what the repo already
calls those things — `wizard` is the name of the control in #111 and #128.

The consequence is that **the code word and the screen word differ for three of
the four values**, `master`/Definiciones included. That is a real cost and it is
accepted deliberately: the alternative is Spanish identifiers, and a mixed-
language identifier set is worse than a translation table with four rows. The
table is `SCREEN_TYPE_LABEL_KEYS`, and it lives next to the enum precisely so
there is one of it.

### Type › domain, always

The sidebar's top tier is the **type**; the domain is the tier beneath it.

```
Definiciones
  Catálogo › Productos, Marcas, Categorías
  Ventas   › Canales
  Sistema  › Configuración
Operaciones
  Ventas   › Pedidos
  Pagos    › Cobros
Asistentes
  Alta de vendedor
  Publicar oferta
Consultas
  Comisiones
```

The trade is explicit. Type-first orients a **new** operator: four fixed entries,
and the question "where do I go to add a courier" has one answer regardless of
which domain owns couriers. Domain-first is faster for a **daily** operator, who
knows the domain and wants fewer clicks. Type-first is chosen because the fleet
will have 11 domains and 4 types, so the shallower top tier is the type's, and
because the daily operator's speed is the command palette's job (#112) rather
than the sidebar's — a person who no longer needs to browse should not be
browsing.

What it costs, recorded rather than discovered later: an asistente sits far from
the definiciones it operates on. "Publicar oferta" is under Asistentes while
"Productos" is under Definiciones, and those two are one task. The mitigation is
an entry point on the screen — the wizard is reachable as an action from the
record it starts from — not a second nav placement.

### `Worklist` is a variant of Operaciones, not a fifth type

Fiori separates Worklist from List Report, and the distinction is real: "orders
awaiting me" is not "all orders". It is not a **type** here, because the two
screens have the same shape and differ only by a default filter bound to the
principal. Making it a type would put one record class in two nav places, which
is the nav duplication #125 exists to remove. A worklist ships as a preset query
alongside the search aggregator and the palette (#130, #112).

### `Sistema` is Definiciones; `Cuenta` is outside the taxonomy

`Configuración` gets no exception. You author the record, it has no lifecycle,
and other things reference it — that is the definition, and an operator's
intuition that "configuration is different" is about how often they open it, not
about its shape.

`Cuenta` is genuinely outside: it is the signed-in person's own account, not an
administrative surface, it carries no permission (a plain `user` must reach it),
and it is chrome the way the sign-out control is chrome. So **`type` is optional
on `GuardedNavSection`** and the account section declares none. That optionality
is the one escape hatch, and it is narrow on purpose: a section with no type is
not a fifth category, it is a section that is not a screen group at all.

### Where the type is declared, and where it is not

`GuardedNavSection` gains `type?: ScreenType`. That interface lives in
`business-ts-authz` because it is the only layer both a `layer:shell` package and
a `layer:app` can depend on, so **every contributing shell declares its own** —
this is not an edit in the host.

`SCREEN_TYPE_LABEL_KEYS` lives beside the enum rather than in the renderer. The
keys are `shell:`-namespaced copy sitting in a `business:policy` package, which
is unusual and is the point: the four names are one shipped vocabulary, and a
second declaration site for them is the exact drift `nav.ts` was already merged
once to stop. Only `app:` is namespace-restricted (to `apps/`), so this is legal
as well as intended.

## Consequences

- `GuardedNavSection` carries `type?: ScreenType`, and the three contributed nav
  lists declare it. `visibleNav` propagates it — a filter that dropped it would
  make the tier unbuildable downstream.
- The sidebar does not yet render the tier. This record fixes the IA; the nested
  rendering is #113's design and #123's build, and #125 collapses the two nav
  sources first. Declaring the type before anything groups by it is deliberate:
  the alternative is three shells retrofitting a field under time pressure from
  a fourth ticket.
- **`TabKind` prefixes follow, but not here.** `catalog:` / `entity:` / `system:`
  become type-derived (`master:`, `operation:`, …) when #141 makes the workspace
  registry derive from the nav. Renaming them by hand now is work done twice, and
  every rename abandons whatever persisted tabs a workspace was holding.
- New copy: `shell:nav.screenType.{master,operation,wizard,report}` in both
  locales.
- `makeEntityCrud` is now the generator for **one named type**. A screen that is
  not Definiciones is not a bug in the generator.

## Alternatives considered

- **`Maestros`.** The ERP-standard word, and the first proposal. Rejected above:
  it needs the background to parse, and the four names read better as one
  register. `Datos maestros` reads without the background and is too long for a
  collapsing sidebar.
- **Domain › type.** Faster for the operator who already knows the system, and it
  keeps a wizard next to the records it touches. Rejected because it makes the
  top tier grow with the domain count (11 at v1) and gives a new operator no
  orientation at all — which is the thing this record was opened to provide.
- **Type as metadata only, never a nav tier.** Cheapest: `type` drives which
  generator builds a screen and nothing else, and the sidebar stays flat. It
  keeps the generative rule, which is the more valuable half, but it drops the
  orientation entirely and leaves the sidebar growing by accretion — the state
  this record is correcting.
- **A fifth `Bandeja` type for worklists.** Would earn a distinct default view,
  a count badge and an empty state meaning "nothing pending" rather than "no
  data". Rejected as a taxonomy value; those are affordances of an Operaciones
  screen with a preset filter, and a fifth value is one every section must then
  choose from.

## Residuals

- An operator who knows ERP vocabulary will look for `Maestros`. Nothing
  resolves that synonym until the command palette does.
- Four types is a claim about screens that do not exist yet. If a screen in
  M1–M6 fits none of them, that is the signal to reopen this — not to widen a
  definition until it does.
- `type` being optional is an escape hatch, and escape hatches get used. Today
  exactly one section declares none (`Cuenta`) and the reason is on the
  declaration; a second one appearing without a written reason means the
  taxonomy is missing a case.

## Relationship to other records

Supersedes nothing and amends nothing. It sits beside ADR 0026, which gave an
entity its verbs and so made "publish" expressible — this record is what stops
that expressiveness turning every entity into an Operaciones screen.
