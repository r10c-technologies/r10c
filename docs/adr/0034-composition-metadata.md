# 34. Composition metadata: an entity can declare that it owns a collection

- Status: Accepted
- Date: 2026-09-01
- Revised: 2026-09-02 by [ADR 0038](0038-master-detail-the-rows-a-record-owns.md) — four of its residuals are now built; the decisions are unchanged.

## Context

`MetaAccessorType` was a taxonomy of five scalars plus two reference shapes:

```ts
['string', 'number', 'boolean', 'date', 'enum', 'id', 'link', 'linkCollection'];
```

Nothing in it says "many of these". The ticket that opened this recorded the
consequence as `ProductOrder` having six accessors and **no items member** — an
order with no lines. That is not what the source says, and the truth is worse.

### Measured: five members declaring a type they do not have

`ProductOrder.items` exists. It is declared `type: 'string'`, and its own doc
comment admits why:

> An object array, so it falls outside the `MetaAccessorTypes` taxonomy — the
> same situation as `Membership.roleIds`.

Four more members do the same, and the comment names the pattern:

| Member                  | Holds                   | Was      |
| ----------------------- | ----------------------- | -------- |
| `ProductOrder.items`    | `readonly OrderItem[]`  | `string` |
| `DictionaryTerm.values` | `readonly string[]`     | `string` |
| `Role.permissions`      | `readonly Permission[]` | `string` |
| `Entitlement.domains`   | `readonly string[]`     | `string` |
| `Membership.roleIds`    | `readonly string[]`     | `string` |

Every one declared `sortable: false, filterable: false` by hand, which is the
tell: five authors each worked out independently that the type they were forced
to write would be wrong if anything acted on it.

The lie was load-bearing at four layers. `SCALAR_TYPES` hands a `string` its
sortable/filterable defaults, so the manual `false` was the only thing standing
between an array and the RSQL allowlist. `coerceFieldValue` passed the draft
string straight back. `FieldControl` rendered a text input. And `CellValue`'s
`default: String(value)` prints `[object Object]` for a row array.

### The one defect that was already live

For a `string[]`, `seedFieldValue` fell through to `String(raw)` — which is
`'a,b'`, by way of `Array.prototype.toString` — and `coerceFieldValue` handed
the same `'a,b'` back as a **string**. Opening a `Membership` and saving it
without touching the roles replaced an array of two ids with one comma-joined
value.

The fixed-point spec in `entifix-react-integration` exists precisely to catch a
seed/coerce disagreement, and it could not see this one: both halves were wrong
in the same direction, so the round trip was still a fixed point. Only checking
the rebuilt member's **type** catches that class of bug, and it now does.

### What made this safe to change now

Nothing renders any of the five. `makeEntityCrud` is wired for `ProductBrand`,
`ProductCategory` and `ProductSpecification`; `user-new-page.tsx` is a
deliberately hand-written form. So the contract could be fixed with no UI to
renegotiate — which is the argument for landing it before the detail control
rather than inside it.

## Decision

### 1. Two types, not one

```ts
'composition'; // owned rows      — Order → OrderItem
'scalarCollection'; // a bare string[] — Membership.roleIds
```

They differ in the two ways that matter to every consumer. A
`scalarCollection` has **no child shape** and a **lossless string form**
(`a,b,c`), so it round-trips through today's string draft and needs no editor
built for it. A `composition` has a child shape and no string form at all.

Collapsing them would mean either giving a `string[]` a child constructor it
cannot have, or giving a row array a comma coercion it cannot survive.

### 2. `composition` is not `linkCollection`

|          | `linkCollection`                            | `composition`                                |
| -------- | ------------------------------------------- | -------------------------------------------- |
| Relation | **association** — targets live on their own | **composition** — no life outside the master |
| Editing  | pick from existing                          | add / edit / delete inline                   |
| Save     | two writes, two lifetimes                   | **one write**                                |
| Example  | Product → Tags                              | Order → OrderItems, Invoice → lines          |

`EntityCollectionLink` resolves ids through an `EntityLinkResolver`, which is
exactly the per-row fetch a composition never wants. Building master-detail on
it would have been the wrong seam, and the to-many association editor (#26)
remains a separate, still-open piece of work.

### 3. A child is described by its accessors, not by being an `Entity`

`@accessor()` writes to its own class's `Symbol.metadata` bag with no help from
`@entity()`, and `extractMetaAccessors` never asks for a domain, a key or an
`id`. So a child needs accessors and nothing else, and
`describeEntityColumns`/`extractMetaAccessors` relax their target from
`EntityConstructor` to a new `ChildConstructor`. One walk now describes an
entity _and_ one row of the collection it owns.

`OrderItem` therefore becomes an `@accessor()`-annotated class in `values/`. It
stays a **value**: no `@entity()`, no id, no permission namespace, exactly as
ADR 0022 has it. The member declares its child through a thunk:

```ts
@accessor({ type: 'composition', childType: () => OrderItem })
get items(): readonly OrderItem[] { … }
```

A thunk, not a direct reference, because the child and its owner are usually
declared in the same package and a direct reference makes decorator evaluation
order load-bearing.

### 4. The serializer learns about composition, and it had to

The first draft of this decision said `childType` was a shape declaration only
— children would stay plain objects and the serializer would keep passing the
array through, as it did when `items` was a `string`.

That is wrong the moment the child is a class. A child's state lives in its
private fields, so `serializeEntity` walking `instance[name]` and emitting the
value untouched writes **`[{}, {}]`** to Mongo, and the order comes back with
lines that hold nothing. The bug is silent at every layer: the write succeeds,
the document validates, and the lines are simply gone.

So `serializeEntity` maps a `composition` member through the child's own
accessors, and `buildEntityInstance` rebuilds each row through them on the way
back. Two consequences worth stating. A child's `alias` is its storage column
exactly as an entity's is — `quantity` can persist as `qty` — so there is still
no mapping layer anywhere. And serialization reads a **plain object** as
happily as an instance, which is deliberate: a fixture or a hand-built command
payload produces the same document.

### 5. A collection is never sortable or filterable, and saying otherwise throws

Both new types stay out of `SCALAR_TYPES`, so they default to unqueryable and
the five entities no longer need their hand-written `false`.

But an author can still _write_ `filterable: true`, and this descriptor is also
the **server-side RSQL allowlist**. An array compared as a scalar does not
error — it matches nothing — so the symptom is an empty result page rather than
a failure anyone can act on. `describeEntityColumns` therefore throws an
`EntifixBuildError`, the same posture as `applyEntityLinks` on an unbuildable
`embedded` link and `assertLinkSourcesAreEditable` on a misaimed picker.

Clamping silently to `false` was the alternative and is worse: the author keeps
a declaration that reads as honoured.

**Consequence: `coerce-rsql.ts` needs no change.** A collection can never reach
`coerceValue`, and a case there would be dead code guarding a door already
locked upstream.

### 6. `scalarCollection` round-trips now; `composition` does not

`seedFieldValue` joins an array on the comma and `coerceFieldValue` splits it
back — declared on both sides, as inverses, rather than arriving by accident
through `Array.prototype.toString`. Empty reads as `[]`, never `undefined`: a
member the user cleared holds no values, which is a different fact from one
that was never set, and only the empty array lets a `required` check judge the
right thing. That is the same ordering trap `boolean` and `number` already
carry.

`composition` is excluded from `reconstructEntity`'s scalar walk beside
`link`/`linkCollection`. It has no editor, so a draft never holds its rows, and
writing the member anyway would blank a record's own lines on every save of an
unrelated field.

### 7. The draft is not widened here

`EntityDraft` stays `Record<string, string>`. `scalarCollection` does not need
more, and `composition` has no editor to need it for — the row shape (client
keys for unsaved rows, `items[2].quantity` error addressing) is #110's call, and
[ADR 0032](./0032-what-may-live-in-an-autosaved-draft.md) already licenses the
widening to `JsonValue` when it comes.

What did land is the collapse of **four** structurally identical aliases —
`EntityFormValues`, `EntityFormDraft`, `EntityLinkDraft` and `EntityCrudDraft` —
into one `EntityDraft` in core. Nothing connected them, so widening the draft
later would have meant finding four declarations by search.

### 8. Detail is same-store, same-slice — pinned in the contract

A composition saves in **one write**. `docs/_shared/planes.md` sends a
cross-domain write through the saga and never through one transaction, so a
child living in another store is not a master-detail form at all: it is a saga.
This is a rule the metadata cannot enforce — `childType` names a class, not a
store — so it is recorded here and belongs in review.

### 9. A tenth type cannot be added silently

Nothing in the repo guarded `MetaAccessorType` exhaustively. Every switch over
it — `coerceValue`, `formatByType`, `coerceFieldValue` — carries a `default`
that treats the value as a string, so a new type would compile, render through
`String(value)`, and be unqueryable by accident rather than by decision.

Rather than force a `never` into files that legitimately want a `default`, core
now exports `COLLECTION_TYPES` beside `SCALAR_TYPES`, and a spec asserts that
those two plus `['id', 'link']` **partition** `MetaAccessorTypes` exactly. Adding
a type without classifying it fails there, and the classification is what every
other site already reads.

## Consequences

- The five members declare what they hold. `Membership.roleIds` survives a save.
- `ProductOrder` is ready for M3: its lines are declared, they persist, and they
  come back as children.
- `describeEntityColumns` throws on a declaration it used to accept. That is a
  build-time-shaped failure surfaced at first render or first request, which is
  loud — and unreachable in correct code.
- One draft type to widen when #122 needs rows.
- A composition member renders read-only in a form and as a row count in a
  table. That is a visible gap, on purpose: a disabled text box holding
  `[object Object]` would be worse than an honest absence.

## Alternatives considered

- **One `collection` type with an optional child.** Rejected: every consumer
  would branch on whether the child is present, which is the two types back
  again with the discriminant moved somewhere less checkable.
- **Make `OrderItem` an `@entity()`.** Rejected: it has no identity, is never
  addressed apart from its order, and would acquire a domain, a key and a
  permission namespace that mean nothing. ADR 0022 already settled that it is a
  value.
- **`childFields: EntityFieldDescriptor[]` written by hand**, mirroring
  ADR 0014's `EntityForm({ fields })` seam. Rejected: it duplicates the child's
  own shape in a second place, with nothing to keep the two in step.
- **Keep children as plain objects and leave the serializer alone.** Rejected
  once measured — see decision 4. It writes `[{}, {}]`.
- **Clamp `filterable` to `false` instead of throwing.** Rejected: it leaves a
  declaration standing that reads as honoured, and the failure it hides is an
  empty page rather than an error.

## Residuals

- ~~**Row identity before the server assigns an id**~~ and ~~**the draft
  widening**~~ — settled by [ADR 0038](./0038-master-detail-the-rows-a-record-owns.md):
  the key is `ROW_KEY`, carried inside the row, and the draft holds
  `string | EntityRowDraft[]`.
- ~~**Nested error addressing does not exist.**~~ Also 0038's: `issueFieldName`
  joins the whole issue path, so a row member is keyed `items[2].quantity`.
- **SQL persistence is still flat-scalar only** (`make-sql-repository.ts` says
  so). A composition persists in Mongo today and nowhere else.
- ~~**A composition's rows are not validated.**~~ Settled by
  [ADR 0038](./0038-master-detail-the-rows-a-record-owns.md), which walks each
  row against the child's descriptors and reads `required` on the collection
  itself as "at least one row".
- **`linkCollection` still has no editor** (#26). Unchanged by this record, and
  deliberately not folded into it: association and composition are different
  problems with different controls.

## Relationship to other records

Builds on [ADR 0032](./0032-what-may-live-in-an-autosaved-draft.md), which
settled what a draft may contain and named master-detail rows as one of three
things queued behind it. **Supersedes nothing and amends nothing** — ADR 0022's
reading of `OrderItem` as a value is confirmed here, not revised.
