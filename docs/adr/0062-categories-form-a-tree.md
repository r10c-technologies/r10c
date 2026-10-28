# 62. Categories form a tree

- Status: Accepted
- Date: 2026-10-23
- Area: business
- Revised: 2026-10-24 — the back office's parent picker now excludes the record and its subtree, through entifix 0.7.1's per-record link filter ([#400](https://github.com/r10c-technologies/r10c/issues/400)); the list holds 200 categories a page, so one page is the whole tree.
- Read when: adding a category level, rendering breadcrumbs or category navigation, or retiring a category — any depth up to five, an offering may sit in any node, a category page lists its whole subtree, and a category with active children cannot be retired
- Revised: 2026-10-28 by [ADR 0064](0064-failures-reach-the-slice-shell.md) — each refusal below becomes a tagged failure carrying that code, answered as a problem body; the catalog-reference slice migrates in wave 3, and until then the codes are unchanged

## Context

`ProductCategory` has `code`, `name`, `description` and `status`, and no parent
([#326](https://github.com/r10c-technologies/r10c/issues/326)). So the
storefront's breadcrumbs are one level deep and its category navigation is a
flat strip. A marketplace that merges every vendor's catalog into one browse
tree (ADR 0022 is why `catalog-reference` is platform plane at all) needs that
tree to have depth: _Hogar › Iluminación › Lámparas de escritorio_, not three
unrelated words.

Nothing in entifix models a hierarchy today: no parent metadata, no tree helpers,
no tree rendering. The framework half of this decision is entifix's to record,
and is tracked as
[#390](https://github.com/r10c-technologies/r10c/issues/390). This record
is r10c's half: the rules the catalog's tree follows.

## Decision

### A category names its parent

`ProductCategory` gains `parentId?`, the id of another category in the same
store, declared as the entity's parent through entifix's hierarchy metadata.

- **An id, not a `link`.** It is the same store, so a `link` would be legal.
  But the storefront deserializes categories it reads over REST without a
  resolver, and the tree is always built from the whole vocabulary anyway (see
  below), so there is never a single parent to fetch lazily.
- **Absent means a root.** There is no synthetic "All" node. The top level is
  the set of active categories with no parent.

### The invariants, enforced at save

The catalog-reference use cases that write a category refuse, with a `409` and
a code the errors catalog carries:

| Refused                                              | Code                    |
| ---------------------------------------------------- | ----------------------- |
| a parent that does not exist                         | `categoryParentMissing` |
| a parent that is retired                             | `categoryParentRetired` |
| a parent that is the category itself or a descendant | `categoryCycle`         |
| a tree deeper than five levels                       | `categoryTooDeep`       |
| retiring a category that still has active children   | `categoryHasChildren`   |

**Five** is a sanity cap, not a product limit. No marketplace browse tree people
navigate by hand is deeper, and the cap is what keeps an ancestor walk bounded
when the data is wrong.

**Retiring a parent is refused, not cascaded.** A cascade would retire
categories the operator never looked at, and each one carries its own
offerings. Refusing makes the operator retire or move the children first, so
nothing leaves the storefront as a side effect.

Un-retiring needs no rule of its own: a category whose parent is retired cannot
be saved active, by the second row.

### An offering may sit in any node

There is no leaves-only rule. A specification classified under _Iluminación_
directly is legitimate, because a vendor does not always know the finer
category. **A category page lists its whole subtree**: the category and every
active descendant, through `categoryId in (…)`.

### The tree is built in memory

The browse vocabulary is operator-authored, platform-wide and small, which is
why `catalog-reference/next` already reads all of it in one bounded request
(`VOCABULARY_PAGE_SIZE`). So the storefront and the back office build the tree
from that one read with entifix's tree helpers. There is no recursive query, no
materialized path and no `$graphLookup`, and nothing has to be kept consistent
on write beyond the invariants above.

If the vocabulary ever outgrows one read, the fix is the one `vocabulary.ts`
already names for brands: a read filtered by id. A materialized ancestor path
would be the second step, and it is not needed until a listing has to filter on
a subtree it cannot enumerate.

### What the storefront does with it

- **Breadcrumbs** are the ancestor chain of the offering's category, root
  first.
- **Category navigation** shows the roots, and a category page shows its
  children.
- **A retired category's subtree leaves browsing with it.** That follows from
  the invariants: a retired category has no active children.

## Consequences

- Five new error codes, each in both locales, which `@r10c/i18n-check` enforces.
- The back office edits the tree in entifix's tree table, with a parent picker.
  The cycle row above is the server's guard. The picker keeps it from being
  reached by leaving out the record and its descendants, which it finds in the
  same page of categories the list loads (200 a page, so the whole tree).
- The seed gains a two-level tree, and a lab that already has categories needs a
  `dev:reset`, because the seed never rewrites an existing row.

## What this does not build

A category belonging to two parents (a DAG) · per-vendor categories · reordering
siblings by hand (siblings sort by name) · moving a subtree in one operation
(edit the child's parent).
