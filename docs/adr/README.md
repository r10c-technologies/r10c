# Architecture Decision Records

Short records of significant architectural decisions — the context, the decision,
and its consequences. One file per decision, numbered and immutable once
Accepted; a later decision that changes an earlier one is a new ADR that
supersedes it.

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

| #                                                                       | Title                                                                                                | Status   |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------- |
| [0001](0001-observability-and-tooling.md)                               | Observability & platform tooling                                                                     | Accepted |
| [0002](0002-authorization-roles-and-abac.md)                            | Authorization: role aspects behind an ABAC-shaped port                                               | Accepted |
| [0003](0003-i18n-mandatory.md)                                          | i18n is mandatory, and the build enforces it                                                         | Accepted |
| [0004](0004-session-lifetime-devices-and-recovery.md)                   | Session lifetime, device identity, and account recovery (recovery + lockout superseded by 0016)      | Accepted |
| [0005](0005-business-domain-decomposition.md)                           | Business domain decomposition, named from TM Forum ODA/SID                                           | Accepted |
| [0006](0006-multitenancy-planes-and-tenant-storage.md)                  | Multitenancy: three planes, ambient tenancy, storage per organization                                | Accepted |
| [0007](0007-access-model-planes-roles-entitlements.md)                  | Access model: planes, platform roles, tenant-defined roles, entitlements                             | Accepted |
| [0008](0008-domain-modules-and-service-topology.md)                     | Domain modules, storage ownership, and service topology                                              | Accepted |
| [0009](0009-catalog-authoring-and-publication.md)                       | Catalog authoring in the tenant plane, publication into a platform read model                        | Proposed |
| [0010](0010-stock-ledger-reservations-and-concurrency.md)               | Stock as a movement ledger; purchases reserve rather than decrement                                  | Proposed |
| [0011](0011-organization-provisioning-and-migrations.md)                | Organization provisioning, migrations, and per-tenant seeding                                        | Accepted |
| [0012](0012-operator-cross-tenant-access.md)                            | Operator cross-tenant access is an audited crossing, never a bypass                                  | Proposed |
| [0013](0013-tenant-storage-on-postgres.md)                              | Tenant storage on Postgres: schema per organization, one shared pool                                 | Proposed |
| [0014](0014-entity-specifications-and-the-characteristic-dictionary.md) | Vendor-authored entity specifications, pinned per instance, comparable through a platform dictionary | Proposed |
| [0015](0015-asymmetric-access-tokens-and-the-party-role-claim.md)       | Asymmetric access tokens, and the party role as a claim                                              | Accepted |
| [0016](0016-zitadel-authenticates-r10c-authorizes.md)                   | Zitadel authenticates; r10c authorizes and mints its own tokens                                      | Accepted |
| [0017](0017-back-channel-logout-from-the-identity-provider.md)          | Back-channel logout: the provider can end an r10c session                                            | Accepted |
| [0018](0018-the-hosted-login-is-a-second-container.md)                  | The hosted login is a second container (Zitadel login v2 on its own origin)                          | Accepted |

The business-side records (0005 onward) are summarized as one map in
[docs/BUSINESS-ARCHITECTURE.md](../BUSINESS-ARCHITECTURE.md).
