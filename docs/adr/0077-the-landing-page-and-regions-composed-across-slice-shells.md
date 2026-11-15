# 77. The back office's landing page, and regions composed across slice shells

- Status: Proposed
- Date: 2026-11-15
- Area: frontend
- Read when: adding the back office's landing page, or a record page shows records another slice owns — the home has no screen type and writes nothing, and only the host passes one shell's region into another's page

## Context

Batch 0 found two screens the back office lacks and a vendor needs
([#591](https://github.com/r10c-technologies/r10c/issues/591), b0-01 and
b0-15): a home that says what needs attention today, and one product workspace
where the offering, its price, its stock, its images and its publication are
read together rather than across four screens.

entifix 0030
([a reference names its target through the owner's read port](https://github.com/r10c-technologies/entifix/blob/v0.22.0/docs/adr/0030-a-reference-names-its-target-through-the-owners-read-port.md))
decides that a record page composes **related regions** — lists of the records
that refer to it, each read through its own adapter — and that this is not
master-detail ([ADR 0038](0038-master-detail-the-rows-a-record-owns.md)): the
page owns none of those rows and writes none of them. It leaves two questions to
the host, and r10c has to answer them before either screen is built.

**The home is not a screen type.** [ADR 0033](0033-the-screen-taxonomy.md) has
four types — Definiciones, Operaciones, Asistentes, Consultas — and the
sidebar renders exactly those ([ADR 0041](0041-the-sidebar-renders-the-taxonomy.md)).
A landing page is none of them, and entifix declined to make one
(entifix#236 ships a summary tile, not a dashboard organism): which counts a
vendor sees first is the host's layout, not the framework's.

**The product workspace's regions come from two slices.** The offering's page is
`@r10c/shells-next-marketplace-admin`'s; its stock region is
`@r10c/shells-next-stock`'s, whose rows live in another slice's store
([ADR 0020](0020-stores-and-slices.md)). A shell never imports another shell —
the `shell:*` dimension fails the build — yet `makeEntityCrud({ regions })` is
declared in the shell that owns the offering.

## Decision

### 1. The home is the shell's landing route, outside the sidebar taxonomy

The back office's home is the route a signed-in person lands on. It has the
**Consultas shape** — a read-only aggregate with no verbs — but it carries no
`ScreenType` and is not a nav section. That is the same narrow escape hatch ADR
0033 grants `Cuenta`, and for a sibling reason: `Cuenta` is about the person,
the home is about the person's day; neither is a destination in a domain.

Every tile on it is a **link into an Operaciones list or record**, filtered to
what the tile counts. The home writes nothing: a verb belongs on the screen the
tile leads to, where the record's own legal states decide it
([entifix 0029](https://github.com/r10c-technologies/entifix/blob/v0.22.0/docs/adr/0029-a-verb-declares-the-states-it-is-legal-from.md)).
A tile whose source fails says so in its own place and leaves the others
standing (entifix 0028's states, per tile).

### 2. Each shell exports its own pieces, and only the host composes them

- Each slice shell exports **its tiles** (a count, a label, where it leads) and
  **its related lists** (the `RelatedList` its own `EntityCrud` returns), built
  against the adapter that shell already mounts.
- The offering's shell exports a **factory**, `productOfferingCrudWith({ regions })`,
  instead of a fixed `productOfferingCrud`. Called with no regions it is the
  page that exists today.
- **Only `apps/back-office-app` passes another shell's region into it**, in the
  same place it already concatenates `NAV` and `SEARCH_SOURCES`. No shell
  imports another; the host is the composition root, which is what the `shell:*`
  rule exists to keep true.

### 3. A region reads and writes only its own slice

A region is read under the reader's session, through the adapter its own shell
mounts, against its own slice's service — so it is narrowed and guarded exactly
as its own list screen is, and a region a reader may not see is a region that
answers them nothing. A change that must be atomic across slices is a **flow**
([ADR 0066](0066-flows-run-on-a-durable-workflow-engine.md)), never a page that
saves two regions in sequence.

### 4. The product workspace is the offering's Definiciones object page

It is not a fifth screen type. Its workspace address stays
`master:product-offering:<id>` ([ADR 0042](0042-the-workspace-address-is-the-taxonomy-serialized.md)),
so neither version constant moves. Only the offering form autosaves
([ADR 0032](0032-what-may-live-in-an-autosaved-draft.md)): a region holds
another slice's records, which have their own screens and their own drafts.

## Consequences

- The home and the product workspace are built (#563, #564) without a taxonomy
  change, a grammar change or a cross-shell import.
- A slice that wants a tile on the home adds an export to its own shell and a
  line in the host; nothing in another shell changes.
- The home's absence from the sidebar is deliberate. Its entry is the brand
  link and the post-sign-in landing, as `Cuenta`'s is the account menu.
- A page that needs to _write_ across two regions has to name a flow, which
  makes the cross-slice write visible where ADR 0020 wants it.

## Trigger

Revisit if a second landing-like page appears (a second escape hatch is the
signal that the taxonomy needs a fifth type after all), or if a region needs to
write into a slice its page's shell does not own.
