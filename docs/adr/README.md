# Architecture Decision Records

Short records of significant architectural decisions — the context, the decision,
and its consequences. One file per decision, numbered.

**An ADR's reasoning is immutable; its factual claims are not.** A statement
about how the system is arranged is corrected in place when it stops being true.
A _decision_ that no longer holds is still superseded by a new record, never
edited away. See [ADR 0022](0022-v1-marketplace-module-boundaries.md) for why,
and for the cost this trades away — editing in place loses the ability to
reconstruct what people believed at the time, and `- Revised:` lines plus git
history are a weaker substitute than immutability was. It is a choice, made
because a record that is quietly wrong actively misleads: `CLAUDE.md` instructs
agents to read the relevant ADR before designing in an area.

Format: [Michael Nygard's ADR template](https://github.com/joelparkerhenderson/architecture-decision-record).

## Status lifecycle

**Proposed → Accepted → Superseded.**

- **Accepted** — in effect. The code follows it; a change that contradicts it
  needs a superseding ADR, not a pull request comment.
- **Proposed** — decided in full but not yet implemented. A Proposed record
  carries a `## Trigger` section naming what promotes it. It exists so the
  iteration that finally needs the decision inherits the reasoning instead of
  re-deriving it, so **read it before designing in that area** — and if you
  diverge, supersede it explicitly rather than leaving two answers on record.
- **Superseded** — replaced. Kept, never deleted, with a link forward.

## Correcting a record

Three tiers. The first two edit in place; only the third uses a new record.

- **Fix** — the record asserts something about the codebase that is now false
  (ADR 0014 naming the wrong owner for the characteristic dictionary, say).
  Correct it where it stands.
- **Clarify** — the reasoning holds and the wording now misleads. Rewrite in
  place, usually as a dated blockquote beside the original so the change is
  visible rather than silent.
- **Supersede** — the _decision_ no longer holds. A new ADR, with a blockquote in
  the old record pointing forward and its text kept.

A **Proposed** record is corrected freely: it is not in effect, so there is
nothing to preserve. An **Accepted** record gains a header line —

```
- Revised: <date> by [ADR 00XX](00XX-….md) — <what changed, in one clause>
```

— so `grep -n "Revised:" docs/adr/0*.md` lists every in-place edit ever made.
(`- Amended by: [ADR 00XX](…)` is the equivalent older form and still counts.)

**Supersession is symmetric, and that is the rule most easily missed.** A record
that claims it supersedes or amends another must leave the reciprocal line _on
the record it overrode_ — writing it only forward means a reader who opens the
old ADR sees `Status: Accepted` and no marker. That is not hypothetical: ADR 0004
described `POST /api/auth/password/forgot`, emailed reset links and an attempt
limiter for a week after ADR 0016 deleted the credential they operated on, while
the index table below already carried the correction. ADR 0015→0002,
ADR 0018→0016 and ADR 0021→0008 were one-way in the same way.

`pnpm nx test @r10c/docs-check` now fails the build on a one-way claim, so the
back-link is not a matter of remembering. Note the deliberate exception the check
allows: "extends ADR 00XX and **supersedes nothing**", used verbatim by ADR 0017
and ADR 0019, asserts the absence of a supersession and needs no reciprocal.

When a change contradicts existing records, grep for the claim rather than
guessing which records mention it: ADR 0014 stated the dictionary's owner in
three separate places. And check each Proposed record's own `## Trigger` section
individually before promoting it — of the five checked in ADR 0022, two fired and
three did not.

The index below is **generated** by `tools/sync-docs.mjs` from each record's H1,
`- Status:`, `- Date:` and `- Revised:`/`- Amended by:` lines. Add a record, run
`node tools/sync-docs.mjs`, stage the result; editing between the markers fails
the commit.

**Read the `Revised by` column, not just `Status`.** A record stays `Accepted`
when only a section of it was superseded, so `Status` alone cannot tell a fully
binding record from one that is binding except in three places.

<!-- docs:begin adr-index -->

| #                                                                                    | Title                                                                                                | Status   | Date       | Revised by                                                                                                                                                                       |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | -------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [0001](0001-observability-and-tooling.md)                                            | Observability & platform tooling                                                                     | Accepted | 2026-07-22 | in place                                                                                                                                                                         |
| [0002](0002-authorization-roles-and-abac.md)                                         | Authorization: role aspects behind an ABAC-shaped port                                               | Accepted | 2026-07-24 | [0015](0015-asymmetric-access-tokens-and-the-party-role-claim.md), [0016](0016-zitadel-authenticates-r10c-authorizes.md), [0037](0037-entitlement-aware-navigation.md)           |
| [0003](0003-i18n-mandatory.md)                                                       | i18n is mandatory, and the build enforces it                                                         | Accepted | 2026-07-26 | [0026](0026-the-use-case-descriptor-and-served-entity-metadata.md)                                                                                                               |
| [0004](0004-session-lifetime-devices-and-recovery.md)                                | Session lifetime, device identity, and account recovery                                              | Accepted | 2026-07-26 | [0016](0016-zitadel-authenticates-r10c-authorizes.md)                                                                                                                            |
| [0005](0005-business-domain-decomposition.md)                                        | Business domain decomposition, named from TM Forum ODA/SID                                           | Accepted | 2026-08-01 | [0022](0022-v1-marketplace-module-boundaries.md)                                                                                                                                 |
| [0006](0006-multitenancy-planes-and-tenant-storage.md)                               | Multitenancy: three planes, ambient tenancy, storage per organization                                | Accepted | 2026-08-01 | [0020](0020-stores-and-slices.md), [0022](0022-v1-marketplace-module-boundaries.md), [0023](0023-service-to-service-tenant-crossing.md)                                          |
| [0007](0007-access-model-planes-roles-entitlements.md)                               | Access model: planes, platform roles, tenant-defined roles, entitlements                             | Accepted | 2026-08-01 | [0022](0022-v1-marketplace-module-boundaries.md), [0037](0037-entitlement-aware-navigation.md)                                                                                   |
| [0008](0008-domain-modules-and-service-topology.md)                                  | Domain modules, storage ownership, and service topology                                              | Accepted | 2026-08-01 | [0020](0020-stores-and-slices.md), [0021](0021-consolidating-the-fleet-into-five-deployments.md), [0022](0022-v1-marketplace-module-boundaries.md)                               |
| [0009](0009-catalog-authoring-and-publication.md)                                    | Catalog authoring in the tenant plane, publication into a platform read model                        | Accepted | 2026-08-01 | [0020](0020-stores-and-slices.md), [0022](0022-v1-marketplace-module-boundaries.md)                                                                                              |
| [0010](0010-stock-ledger-reservations-and-concurrency.md)                            | Stock as a movement ledger; purchases reserve rather than decrement                                  | Accepted | 2026-08-01 | [0022](0022-v1-marketplace-module-boundaries.md)                                                                                                                                 |
| [0011](0011-organization-provisioning-and-migrations.md)                             | Organization provisioning, migrations, and per-tenant seeding                                        | Accepted | 2026-08-01 | [0022](0022-v1-marketplace-module-boundaries.md), [0024](0024-selling-through-a-vendors-own-channel.md)                                                                          |
| [0012](0012-operator-cross-tenant-access.md)                                         | Operator cross-tenant access is an audited crossing, never a bypass                                  | Proposed | 2026-08-01 | [0020](0020-stores-and-slices.md), [0023](0023-service-to-service-tenant-crossing.md)                                                                                            |
| [0013](0013-tenant-storage-on-postgres.md)                                           | Tenant storage on Postgres: schema per organization, one shared pool                                 | Proposed | 2026-08-01 | [0022](0022-v1-marketplace-module-boundaries.md)                                                                                                                                 |
| [0014](0014-entity-specifications-and-the-characteristic-dictionary.md)              | Vendor-authored entity specifications, pinned per instance, comparable through a platform dictionary | Proposed | 2026-08-02 | [0022](0022-v1-marketplace-module-boundaries.md), [0026](0026-the-use-case-descriptor-and-served-entity-metadata.md)                                                             |
| [0015](0015-asymmetric-access-tokens-and-the-party-role-claim.md)                    | Asymmetric access tokens, and the party role as a claim                                              | Accepted | 2026-08-05 | [0022](0022-v1-marketplace-module-boundaries.md)                                                                                                                                 |
| [0016](0016-zitadel-authenticates-r10c-authorizes.md)                                | Zitadel authenticates; r10c authorizes and mints its own tokens                                      | Accepted | 2026-08-05 | [0018](0018-the-hosted-login-is-a-second-container.md)                                                                                                                           |
| [0017](0017-back-channel-logout-from-the-identity-provider.md)                       | Back-channel logout: the provider can end an r10c session                                            | Accepted | 2026-08-07 | in place                                                                                                                                                                         |
| [0018](0018-the-hosted-login-is-a-second-container.md)                               | The hosted login is a second container                                                               | Accepted | 2026-08-08 | in place                                                                                                                                                                         |
| [0019](0019-provider-user-lifecycle-events-revoke-sessions.md)                       | A user deactivated at the provider loses their r10c sessions                                         | Accepted | 2026-08-11 | —                                                                                                                                                                                |
| [0020](0020-stores-and-slices.md)                                                    | Stores and Slices: naming the unit of data ownership and the unit of deployment                      | Accepted | 2026-08-11 | [0022](0022-v1-marketplace-module-boundaries.md)                                                                                                                                 |
| [0021](0021-consolidating-the-fleet-into-five-deployments.md)                        | Consolidating the fleet into five deployments                                                        | Accepted | 2026-08-12 | [0022](0022-v1-marketplace-module-boundaries.md)                                                                                                                                 |
| [0022](0022-v1-marketplace-module-boundaries.md)                                     | The v1 marketplace: final domain, store and slice boundaries                                         | Accepted | 2026-08-12 | [0024](0024-selling-through-a-vendors-own-channel.md)                                                                                                                            |
| [0023](0023-service-to-service-tenant-crossing.md)                                   | A service reaching tenant storage for another party names the organization explicitly                | Accepted | 2026-08-12 | —                                                                                                                                                                                |
| [0024](0024-selling-through-a-vendors-own-channel.md)                                | Selling through a vendor's own channel                                                               | Accepted | 2026-08-17 | —                                                                                                                                                                                |
| [0025](0025-where-planning-and-business-knowledge-live.md)                           | Where planning and business knowledge live                                                           | Accepted | 2026-08-17 | in place                                                                                                                                                                         |
| [0026](0026-the-use-case-descriptor-and-served-entity-metadata.md)                   | The use-case descriptor, and entity metadata as a served document                                    | Accepted | 2026-08-19 | [0035](0035-entity-actions-selection-and-bulk.md)                                                                                                                                |
| [0027](0027-two-scales-a-density-mode-and-the-type-system.md)                        | Two scales, a density mode, and the type system                                                      | Accepted | 2026-09-01 | —                                                                                                                                                                                |
| [0028](0028-the-transaction-id-is-the-clients-and-its-event-ships-with-the-write.md) | The transaction id is the client's, and its event ships with the write                               | Accepted | 2026-09-01 | [0029](0029-the-event-envelope-and-a-routed-bus.md), [0030](0030-failure-retry-and-quarantine-on-the-bus.md), [0036](0036-the-reactive-stream-is-server-sent-and-same-origin.md) |
| [0029](0029-the-event-envelope-and-a-routed-bus.md)                                  | The event envelope, and a bus that routes                                                            | Accepted | 2026-09-01 | [0030](0030-failure-retry-and-quarantine-on-the-bus.md)                                                                                                                          |
| [0030](0030-failure-retry-and-quarantine-on-the-bus.md)                              | Failure, retry and quarantine on the bus                                                             | Accepted | 2026-09-01 | —                                                                                                                                                                                |
| [0031](0031-a-service-describes-its-own-wiring.md)                                   | A service describes its own wiring                                                                   | Accepted | 2026-09-01 | —                                                                                                                                                                                |
| [0032](0032-what-may-live-in-an-autosaved-draft.md)                                  | What may live in an autosaved draft                                                                  | Accepted | 2026-09-01 | —                                                                                                                                                                                |
| [0033](0033-the-screen-taxonomy.md)                                                  | The screen taxonomy: Definiciones, Operaciones, Asistentes, Consultas                                | Accepted | 2026-09-01 | —                                                                                                                                                                                |
| [0034](0034-composition-metadata.md)                                                 | Composition metadata: an entity can declare that it owns a collection                                | Accepted | 2026-09-01 | [0038](0038-master-detail-the-rows-a-record-owns.md)                                                                                                                             |
| [0035](0035-entity-actions-selection-and-bulk.md)                                    | Entity actions: where a verb appears, and what a bulk action acts on                                 | Accepted | 2026-09-02 | —                                                                                                                                                                                |
| [0036](0036-the-reactive-stream-is-server-sent-and-same-origin.md)                   | The reactive stream is server-sent, same-origin, and scoped per connection                           | Accepted | 2026-09-02 | —                                                                                                                                                                                |
| [0037](0037-entitlement-aware-navigation.md)                                         | Entitlements ride the access token, and navigation reads them                                        | Accepted | 2026-09-02 | —                                                                                                                                                                                |
| [0038](0038-master-detail-the-rows-a-record-owns.md)                                 | Master-detail: a record and the rows it owns, edited in one write                                    | Accepted | 2026-09-02 | —                                                                                                                                                                                |

<!-- docs:end adr-index -->

The business-side records (0005 onward) are summarized as one map in
[docs/BUSINESS-ARCHITECTURE.md](../BUSINESS-ARCHITECTURE.md).
