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
packages/implementation/<key>/<tech> ← cells: one domain (or store) written in one technology
packages/business/ts/<domain>       ← pure domain entities & use-cases (no framework)
packages/utils/ts/*                 ← generic TS helpers
@entifix/*  (installed)             ← the framework: entity system, adapters, UI and base shells
```

The boundary is enforced by the tag dimensions declared in every project's
`package.json` `nx.tags` (see `eslint.config.mjs`):

- **`layer:*`** — `app` › `shell` › `implementation` › `business` › `utils`; a project may depend only on layers **below** it. `shell` and `business` additionally allow same-layer edges, which their own dimension below then orders. The framework is **not** a layer here: `@entifix/*` is installed from the registry, an external package carries no tags, and any project may import it — what orders the framework internally is its own `tier:*` contract, below.
- **`scope:*`** — a domain scope (`marketplace`, `marketplace-admin`, `auth`, `transaction`, `config`) may depend only on itself or `scope:shared`; `scope:shared` (all of `business` and `utils`) is the reusable core, dependable by anyone. An implementation cell carries the scope of the slice that owns its domain, never `scope:shared` — a second host reaches it by widening the **host** scope, as `scope:back-office` does.
- **`business:*`** — internal ordering inside the business layer: `policy` ‹ `domain`. `business:policy` is the shared vocabulary any domain may express itself in — r10c's grant table (`authz-grants`), the catalog, payment and sales contracts — beside the installed `@entifix/authz` it builds on; a `business:domain` package may reach down to it but **never sideways to another domain**.
- **`tech:*`** — what an implementation cell is **written in**: `react`, `next` and `http` cells are keyed by domain, `mongo`, `redis` and `sql` cells by store ([ADR 0060](../adr/0060-the-implementation-layer-cells.md)). Every implementation project carries exactly one, and `@r10c/docs-check` fails one that carries none or two. It decides what the cell may not **talk through**, as a `bannedExternalImports` rule:
  - a `react`, `next` or `http` cell may not import an adapter (`@entifix/{rest,static,mongo,sql,redis,amqp,jwt,zitadel,posthog}`), a driver, `@entifix/react-controls/i18next`, `@entifix/next-shell/server`, `@tanstack/*` or redux — those are chosen at composition, by a shell or an app; a `react` cell also may not import `next`, and an `http` cell nothing that renders;
  - a `mongo`, `redis` or `sql` cell **is** the adapter, so it may import its own engine's entifix client and driver — and nothing for UI or HTTP, and no other engine's.

  Cell→cell is illegal without a rule of its own: `layer:implementation` allows no same-layer edge. A need that crosses domains goes through a `business:policy` contract or is composed by the shell, which is why the storefront's category page resolves a slug through `catalog-reference/next` and then filters `marketplace-catalog/next` by the id. `@r10c/conventions` lints a planted cell→adapter import and fails if the ban stops catching it.
  ⚠️ **Three entifix entry points are mixed until 0.5.0** — the `.` of `transactions`, `service-shell` and `react-integration` export a mechanism beside their contracts (the saga engine, `makeService`, the EventSource channel), so banning the specifier would ban the contract too. Until those split, the mechanism half is review-only.

- **`shell:*`** — `shell:domain` marks a per-domain shell, which mounts one domain onto the framework's base shells (`@entifix/service-shell`, `@entifix/next-shell`, `@entifix/next-i18n` — installed, so reachable without a tag) and **never imports another domain shell**.
- **`tier:*`** — entifix's own composition contract, carried only by the packages it publishes and checked in the entifix repository by `pnpm nx test @entifix/tiers` rather than by the boundary rule here. Six tiers — `0` standalone (`style`, `tooling`) ‹ `1` entity (`core`, `business`) ‹ `2` adapters (the datastore, REST, JWT, Zitadel and PostHog clients, plus `transactions` and `i18n` — the i18next binding is an adapter to an external library exactly as a driver binding is, which is why it is not standalone) ‹ `3` ui (`react-controls`, `react-integration`) ‹ `4` app framework (the authorization vocabulary and the three base shells) ‹ `5` testing — and a package may depend on its own tier or below.
  ⚠️ **The rule that matters is not the direction.** A hard dependency on a capability the tier is meant to be adoptable without fails the build even though it points downward: a table must not arrive with i18next attached, a Mongo repository must not arrive with the saga engine, and Playwright session helpers must not arrive with three database drivers. Those edges belong in `peerDependencies` with `peerDependenciesMeta.optional`, behind a subpath export — package-level dependencies are not per-subpath, so the optional peer is the part that does the work. The register is entifix's `tools/tiers/src/registry.ts` and
  [ADR 0059](../adr/0059-entifix-leaves-the-repo.md) is the reasoning.
- **`host:*`** — `host:next` (a Next app) may **not** import entifix's datastore clients (`@entifix/mongo`, `@entifix/sql`, `@entifix/redis`, `@entifix/amqp`, or any subpath of them) — a `bannedExternalImports` rule, because an installed package carries no tag to match. A Next backend is composition — cookies, proxying, RSC aggregation — never data access; only a `host:effect` service binds a repository to a datastore.

Spec files may additionally import `type:testing` libs (doubles/fixtures); source files may not. **To add a queryable/importable edge, retag the project — never weaken the rule.** The value of the layering is substitutability: a `business` use-case depends only on contracts (`@entifix/business`), so the same use-case runs on the web against a REST adapter and on a backend against a Mongo adapter, the transport injected at the composition root.
