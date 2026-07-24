<!-- Single source imported by CLAUDE.md and docs/ARCHITECTURE.md. Edit here only. -->

The repo is layered top-to-bottom and **dependencies only point downward**. A
package's name encodes its layer (`@r10c/<area>-<lang>-<name>`), and the Nx
ESLint rule `@nx/enforce-module-boundaries` **fails the build** on any upward edge.

```
apps/                               ← runtime hosts (Next.js frontends / Effect-native services)
packages/shells/{next,effect}/*     ← framework shells: Next pages+adapters / the effect-service base
packages/implementation/<domain>/*  ← a domain wired to a delivery mechanism (React organisms)
packages/business/ts/<domain>       ← pure domain entities & use-cases (no framework)
packages/entifix/{ts,react}/*       ← the entity framework + platform tooling
packages/utils/ts/*                 ← generic TS helpers
```

The boundary is enforced by three tag dimensions declared in every project's
`package.json` `nx.tags` (see `eslint.config.mjs`):

- **`layer:*`** — `app` › `shell` › `implementation` › `business` › `entifix` › `utils`; a project may depend only on layers **below** it.
- **`scope:*`** — a domain scope (`marketplace`, `marketplace-admin`, `auth`, `transaction`, `config`) may depend only on itself or `scope:shared`; `scope:shared` (all of `entifix`/`business`/`implementation`/`utils` + the base shells) is the reusable core, dependable by anyone.
- **`entifix:*`** — internal ordering inside the entifix layer: `core` ‹ `contract` ‹ {`tooling`, `style`} ‹ `transactions` ‹ `client` ‹ `react`.

Spec files may additionally import `type:testing` libs (doubles/fixtures); source files may not. **To add a queryable/importable edge, retag the project — never weaken the rule.** The value of the layering is substitutability: a `business` use-case depends only on contracts (`entifix-ts-business`), so the same use-case runs on the web against a REST adapter and on a backend against a Mongo adapter, the transport injected at the composition root.
