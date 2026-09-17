<!-- Single source imported by CLAUDE.md and docs/ARCHITECTURE.md. Edit here only. -->

The repo is layered top-to-bottom and **dependencies only point downward**. A
package's name encodes its layer (`@r10c/<area>-<lang>-<name>`) — except the
framework, whose packages are `@entifix/<name>`, named for what they are rather
than where they sit because they are published
([ADR 0059](../adr/0059-entifix-leaves-the-repo.md)) — and the Nx
ESLint rule `@nx/enforce-module-boundaries` **fails the build** on any upward edge.

```
apps/                               ← runtime hosts (Next.js frontends / Effect-native services)
packages/shells/next/*              ← per-domain shells: a domain mounted onto the framework's Next shell
packages/implementation/<domain>/*  ← a domain wired to a delivery mechanism (currently unpopulated)
packages/business/ts/<domain>       ← pure domain entities & use-cases (no framework)
packages/utils/ts/*                 ← generic TS helpers
@entifix/*  (installed)             ← the framework: entity system, adapters, UI and base shells
```

The boundary is enforced by five tag dimensions declared in every project's
`package.json` `nx.tags` (see `eslint.config.mjs`):

- **`layer:*`** — `app` › `shell` › `implementation` › `business` › `utils`; a project may depend only on layers **below** it. `shell` and `business` additionally allow same-layer edges, which their own dimension below then orders. The framework is **not** a layer here: `@entifix/*` is installed from the registry, an external package carries no tags, and any project may import it — what orders the framework internally is its own `tier:*` contract, below.
- **`scope:*`** — a domain scope (`marketplace`, `marketplace-admin`, `auth`, `transaction`, `config`) may depend only on itself or `scope:shared`; `scope:shared` (all of `business`/`implementation`/`utils`) is the reusable core, dependable by anyone.
- **`business:*`** — internal ordering inside the business layer: `policy` ‹ `domain`. `business:policy` is the shared vocabulary any domain may express itself in — r10c's grant table (`authz-grants`), the catalog, payment and sales contracts — beside the installed `@entifix/authz` it builds on; a `business:domain` package may reach down to it but **never sideways to another domain**.
  **The implementation layer holds no project today**, and that is a result rather
  than an oversight. It existed for entity-tight React organisms — `ProductTable`,
  `ProductForm` — every one of which was a pass-through whose only non-generic
  token was a class name. `makeEntityCrud` in `@entifix/next-shell` derives them
  from the entity's own metadata instead, so there is nothing left to wrap. The
  layer stays declared, and its tags stay enforced, for the first component that is
  genuinely specific to one domain and cannot be derived.

- **`shell:*`** — `shell:domain` marks a per-domain shell, which mounts one domain onto the framework's base shells (`@entifix/service-shell`, `@entifix/next-shell`, `@entifix/next-i18n` — installed, so reachable without a tag) and **never imports another domain shell**.
- **`tier:*`** — entifix's own composition contract, carried only by the packages it publishes and checked in the entifix repository by `pnpm nx test @entifix/tiers` rather than by the boundary rule here. Six tiers — `0` standalone (`style`, `tooling`) ‹ `1` entity (`core`, `business`) ‹ `2` adapters (the datastore, REST, JWT, Zitadel and PostHog clients, plus `transactions` and `i18n` — the i18next binding is an adapter to an external library exactly as a driver binding is, which is why it is not standalone) ‹ `3` ui (`react-controls`, `react-integration`) ‹ `4` app framework (the authorization vocabulary and the three base shells) ‹ `5` testing — and a package may depend on its own tier or below.
  ⚠️ **The rule that matters is not the direction.** A hard dependency on a capability the tier is meant to be adoptable without fails the build even though it points downward: a table must not arrive with i18next attached, a Mongo repository must not arrive with the saga engine, and Playwright session helpers must not arrive with three database drivers. Those edges belong in `peerDependencies` with `peerDependenciesMeta.optional`, behind a subpath export — package-level dependencies are not per-subpath, so the optional peer is the part that does the work. The register is entifix's `tools/tiers/src/registry.ts` and
  [ADR 0059](../adr/0059-entifix-leaves-the-repo.md) is the reasoning.
- **`host:*`** — `host:next` (a Next app) may **not** import entifix's datastore clients (`@entifix/mongo`, `@entifix/sql`, `@entifix/redis`, `@entifix/amqp`, or any subpath of them) — a `bannedExternalImports` rule, because an installed package carries no tag to match. A Next backend is composition — cookies, proxying, RSC aggregation — never data access; only a `host:effect` service binds a repository to a datastore.

Spec files may additionally import `type:testing` libs (doubles/fixtures); source files may not. **To add a queryable/importable edge, retag the project — never weaken the rule.** The value of the layering is substitutability: a `business` use-case depends only on contracts (`@entifix/business`), so the same use-case runs on the web against a REST adapter and on a backend against a Mongo adapter, the transport injected at the composition root.
