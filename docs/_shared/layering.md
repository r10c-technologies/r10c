<!-- Single source imported by CLAUDE.md and docs/ARCHITECTURE.md. Edit here only. -->

The repo is layered top-to-bottom and **dependencies only point downward**. A
package's name encodes its layer (`@r10c/<area>-<lang>-<name>`), and the Nx
ESLint rule `@nx/enforce-module-boundaries` **fails the build** on any upward edge.

```
apps/                               ← runtime hosts (Next.js frontends / Effect-native services)
packages/shells/{next,effect}/*     ← framework shells: Next pages+adapters / the effect-service base
packages/implementation/<domain>/*  ← a domain wired to a delivery mechanism (currently unpopulated)
packages/business/ts/<domain>       ← pure domain entities & use-cases (no framework)
packages/entifix/{ts,react}/*       ← the entity framework + platform tooling
packages/utils/ts/*                 ← generic TS helpers
```

The boundary is enforced by six tag dimensions declared in every project's
`package.json` `nx.tags` (see `eslint.config.mjs`):

- **`layer:*`** — `app` › `shell` › `implementation` › `business` › `entifix` › `utils`; a project may depend only on layers **below** it. `shell`, `business` and `entifix` additionally allow same-layer edges, which their own dimension below then orders.
- **`scope:*`** — a domain scope (`marketplace`, `marketplace-admin`, `auth`, `transaction`, `config`) may depend only on itself or `scope:shared`; `scope:shared` (all of `entifix`/`business`/`implementation`/`utils` + the base shells) is the reusable core, dependable by anyone.
- **`entifix:*`** — internal ordering inside the entifix layer: `core` ‹ `contract` ‹ {`tooling`, `style`} ‹ `transactions` ‹ `client` ‹ `react`.
- **`business:*`** — internal ordering inside the business layer: `policy` ‹ `domain`. `business:policy` is the shared authorization vocabulary (`business-ts-authz`) that any domain may express itself in; a `business:domain` package may reach down to it but **never sideways to another domain**.
  **The implementation layer holds no project today**, and that is a result rather
  than an oversight. It existed for entity-tight React organisms — `ProductTable`,
  `ProductForm` — every one of which was a pass-through whose only non-generic
  token was a class name. `makeEntityCrud` in `shells-next-common` derives them
  from the entity's own metadata instead, so there is nothing left to wrap. The
  layer stays declared, and its tags stay enforced, for the first component that is
  genuinely specific to one domain and cannot be derived.

- **`shell:*`** — internal ordering inside the shell layer: `base` ‹ `domain`. `shell:base` is the reusable framework shell (`shells-effect-service`, `shells-next-common`, `shells-next-i18n`); a `shell:domain` package mounts a domain onto it. Without this dimension a per-domain API module could not reach `requirePermission`/`makeServerLayer` at all.
- **`host:*`** + **`runtime:datastore`** — `host:next` (a Next app) may **not** depend on a `runtime:datastore` package (`entifix-ts-mongo-client`, `-sql-client`, `-redis-client`, `-amqp-client`). A Next backend is composition — cookies, proxying, RSC aggregation — never data access; only a `host:effect` service binds a repository to a datastore.

Spec files may additionally import `type:testing` libs (doubles/fixtures); source files may not. **To add a queryable/importable edge, retag the project — never weaken the rule.** The value of the layering is substitutability: a `business` use-case depends only on contracts (`entifix-ts-business`), so the same use-case runs on the web against a REST adapter and on a backend against a Mongo adapter, the transport injected at the composition root.
