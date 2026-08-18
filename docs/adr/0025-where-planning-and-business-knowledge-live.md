# 25. Where planning and business knowledge live

- Status: Accepted
- Date: 2026-08-17
- Revised: 2026-08-17 — the Notion space is `r10c`, split by process and
  market, rather than the single `Procesos GT` this record first named

## Context

Everything this repository knows, it knows about itself. The domains, the
stores, the slices, the ports, the reasoning behind each — all of it describes
the machine. [ADR 0022](0022-v1-marketplace-module-boundaries.md) locked eleven
domains and twenty-eight entities; `tools/slices/` makes the register
executable; `@r10c/docs-check` fails the build when a document names something
the source does not declare.

None of that describes the **business the machine has to survive contact with**.
The first target market is Guatemala, and the gap is not decoration:

- An invoice is not valid until an authorized _certificador_ certifies it under
  SAT's FEL regime. That is a synchronous third party inside the sale path, not
  a report generated afterwards.
- Roughly a fifth of e-commerce payments are cash on delivery, so money arrives
  at the courier's hand rather than at checkout — which decouples "the order was
  paid" from "the order was placed" in a way `Payment` currently cannot express.
- A buyer at a counter has no account but must still supply a tax identifier, or
  the sale is recorded against `CF`. [ADR 0024](0024-selling-through-a-vendors-own-channel.md)
  made `buyerId` optional for exactly the right reason and did not know about
  the identifier that has to take its place.
- In-site selling in the region splits into _preventa_ (agent takes the order,
  dispatch delivers later) and _autoventa_ (agent carries stock and sells from
  the vehicle). The second needs a stock location `stock-management` does not
  model.

Each of those is a fact about the world, learned from outside, wrong until
someone who actually files Guatemalan taxes says otherwise. And each of them,
once settled, forces a modelling decision of exactly the kind this repository
already records.

So there are four different kinds of knowledge in play, and the failure mode is
putting them in one place:

1. **How the business works** — volatile, external, needs correction by people
   who will never clone a repository.
2. **What we decided, and why** — stable, reasoned, must not drift.
3. **What the contract is** — entity shapes, stores, ports; already executable.
4. **What is next, and is it done** — state, which none of the other three can
   hold, because a document has no status.

## Decision

**Four artifacts, one job each, and a named seam between them.**

| Artifact                                     | Answers                                | Enforced by             |
| -------------------------------------------- | -------------------------------------- | ----------------------- |
| **Notion** — the `r10c` space                | how the business actually works        | nothing; that is fine   |
| **ADR** — `docs/adr/`                        | what we decided, and why               | `@r10c/docs-check`      |
| **`BUSINESS-ARCHITECTURE.md` + `tools/slices/`** | what the contract is               | `@r10c/slices`          |
| **GitHub issue** under a **milestone**       | what is next, and is it done           | the milestone's own test |

A process question goes to Notion. When it forces a modelling call, that call
becomes an ADR. The consequence lands in the register. The work becomes an issue
that cites all three and adds nothing of its own.

### The space is split by process, then by market

The first draft of this record named the space `r10c — Procesos GT`, which bakes
one market into the tree and makes the second one a rewrite. The split that
holds instead is the one the codebase already uses everywhere else:

> **The process is the port. The market is the adapter.**

`20 · Procesos` describes what happens and in what order, for any market — a
buyer orders, stock is held, the vendor is paid a commission. `30 · Mercados`
holds everything that changes when the country changes: the tax regime, the
document that makes a sale legal, the payment rails people actually use, the
couriers, the shape of an address. A second market costs a sibling folder.

Two further pages carry their own rule. `00 · Mapa` **points and does not
explain** — it links to `tools/slices/`, the ADRs and the milestones, and if it
ever starts describing the model instead of linking to it, it has become the
second copy this record exists to prevent. `10 · Referencias` holds external
material, split the same way the rest is: a TM Forum reference we have
**applied** lives where we applied it — in the glossary's `Source` column, or
quoted in the ADR that used it — while one we are **still reading** lives in
Notion. Issue #95, "confirm the ODA TMFC component code for Sales Management",
is the shape of the second kind: a question against an external standard that
our own source cannot answer.

### Why business processes do not live in `docs/`

Because the enforcement this repository is proud of is aimed the wrong way for
them.

`tools/docs/src/corpus.ts` checks `docs/*.md` — **flat files only**. A
`docs/business/processes/fel.md` is in the repository and in no corpus: no link
check, no anchor check, no router requirement. In-repo but unenforced is
strictly worse than Notion, which at least has search, comments, and a person
who can correct it without a pull request.

Lift it to the top level to gain the checks and the aim becomes actively
hostile. `docs.spec.ts` asserts that the business docs **name nothing the source
does not declare** — every backticked `CapWord` must resolve to a real
identifier in `packages/` or `apps/`. That check exists to catch documentation
describing code that was renamed. Business process documents are the exact
inverse: they exist to name things the code does not have yet. `Certificador`,
`RetencionIVA`, `RutaPreventa` would each need an `EXTERNAL_VOCABULARY`
exemption, or the prose has to avoid code voice entirely.

The repository's documentation checks assume a document describes code that
exists. Discovery notes describe a country that exists and code that does not.

### Why the scope stays in the repository

The symmetric mistake is copying the domain map into Notion "so it is all in one
place". The map is already documented **executably** — `pnpm nx test @r10c/slices`
fails on a domain hosted by two stores, a store claimed by two slices, or an app
opening a datastore no slice declares. A Notion copy has no test behind it and
would win arguments it has not earned.

Notion holds business processes. The repository holds the model. Neither
restates the other.

### Why GitHub issues, and not a Projects v2 board

Issues are already the unit here: ninety-six of them, `sales`-labelled work
already shaped this way, and `/create-pr` already closes them from the commit.
What was missing is grouping, not tooling.

**Milestones are the release grouping, and each one is the promotion of a
planned slice**, which is what makes "done" a fact rather than an opinion:

| Milestone                  | Completes when                                        |
| -------------------------- | ----------------------------------------------------- |
| **M1 — Publish a catalog** | `catalog.published` fills `published-catalog`; the storefront's fixture repository is deleted |
| **M2 — Stock is real**     | the `stock` slice is `active`                         |
| **M3 — Buy something**     | the `order` slice is `active`                         |
| **M4 — Pay for it**        | the `payment` slice is `active`                       |
| **M5 — Sell at the counter** | the `sales` slice is `active`                       |
| **M6 — Pay the vendor**    | the `settlement` slice is `active`                    |

A slice is promoted by the commit that writes its store and never earlier, and
`@r10c/slices` fails the build in both directions. So the milestone's definition
of done is a test that already exists.

Projects v2 is **declined**, not deferred by accident. Its `Status` field is not
the issue's open/closed state, so adopting it creates a second truth to
reconcile by hand — for a single repository with one committer, that is cost
with no return. Milestones, labels and native sub-issues live *on* the issue and
need no synchronisation. Adding a board later costs nothing, because the issues
survive the move.

Domain labels are the mapping back to the model: one word that names a domain, a
permission namespace and a package at once.

### What may be committed

The repository is public today and will be private later. **That order does not
run backwards.** GitHub's documented behaviour on making a public repository
private is that "current forks will remain public and will be detached from this
repository" — they survive as repositories outside our control. Stars and
watchers are erased; the repository leaves the Archive Program. Nothing
un-publishes a commit that was public when it was made.

So exposure is decided **per commit, at commit time, permanently**, and the line
is drawn by ownership rather than by sensitivity:

| Committable, forever public                                            | Notion only                                     |
| ---------------------------------------------------------------------- | ----------------------------------------------- |
| Public law and public mechanism: IVA rates, DTE types, how FEL certification works | our commission percentages and tier structure |
| Ports, entity shapes, ADR reasoning                                    | named pilot vendors and real agreement terms    |
| Milestone and story titles                                             | negotiated courier rates, margin assumptions    |

The test is not "is this secret" but "is this ours". Guatemalan tax law is
already public; our position on it is not.

## Consequences

- **A fourth thing to keep open**, and the seam has to be walked deliberately: a
  Notion page that settles a question does not update the ADR by itself. The
  discipline is that a settled process question produces an ADR in the same
  session it is settled, or it is not settled.
- **Notion is unenforced, and that is the point.** It holds drafts that are
  wrong on purpose until someone corrects them. Pages carry an explicit
  `DRAFT — unverified` marker so a draft is never mistaken for a finding; the
  moment a page becomes load-bearing, the load moves to an ADR.
- **Nothing about the discovery is retrievable by an agent offline.** Reading a
  process requires the Notion MCP server to be connected, where an ADR is in the
  working tree. Accepted deliberately — the alternative is unenforced markdown
  in `docs/`, which is retrievable and stale.
- **The issue becomes the join**, and a story with no citations is a smell: a
  well-formed one names the Notion page (why), the ADR (decision), and the slice
  or port (contract). None of that information is duplicated into it.
- **Milestones bind to the register, so re-ordering them is not free.** M3 cannot
  precede M2 without an order that reserves nothing. The dependency is the
  slices' own, which is why the milestones are named after slice promotions
  rather than after features.
- **The Actions bill arrives with the private flip, not before.** Public
  repositories get unlimited standard-runner minutes; private ones get 2,000 a
  month on Free and 3,000 on Pro or Team. This repository's CI is six jobs with
  `build` and `test` matrix-chunked, so each chunk bills its own wall time. The
  mitigations, cheapest first, are Nx Cloud remote caching, a self-hosted
  runner, and moving `build`/`test` from `run-many` to `affected` as `lint`
  already does. None is urgent; the first is worth doing anyway.
- **This record supersedes nothing.** It is the first to describe where
  knowledge lives rather than what it says.

## Follow-ups (deliberately out of scope)

- The four Notion process pages: Fiscal / FEL, Pagos, Entrega, Agentes de venta.
- The ADRs those pages will force — who issues the DTE, cash on delivery and
  courier remittance, and the preventa/autoventa agent role are the three
  already visible.
- M1–M6 as GitHub milestones, with their stories.
- Nx Cloud remote caching, before the repository goes private.
