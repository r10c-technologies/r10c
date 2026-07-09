# R10c

<a alt="Nx logo" href="https://nx.dev" target="_blank" rel="noreferrer"><img src="https://raw.githubusercontent.com/nrwl/nx/master/images/nx-logo.png" width="45"></a>

Nx + pnpm monorepo for the **entifix** entity framework and the marketplace apps built on it. Everything is layered top-to-bottom and **dependencies only point downward**.

## Architecture at a glance

```
apps/                               ← runtime hosts (Next.js / Nest / Express mocks)
packages/shells/{next,nest}/*       ← framework shells: pages, context providers, adapter wiring
packages/implementation/<domain>/*  ← domain wired to a delivery mechanism (React organisms, Nest modules)
packages/business/ts/<domain>       ← pure domain entities & use-cases (no framework)
packages/entifix/{ts,react}/*       ← the entity framework (core / business / rest-client / react/*)
packages/utils/ts/*                 ← generic TS helpers
```

The framework is decorator + [Effect](https://effect.website)-based:

- **`entifix-ts-core`** — `@entity()` / `@accessor()` register metadata on `MetaEntity`. Domain types (`Entity`, `EntityLoadRequest`, `EntityPage`, filtering/sorting). **Entity links** (`EntityLink` / `EntityCollectionLink`) model relations as either a foreign key or embedded data, resolved lazily through an `EntityLinkResolver`.
- **`entifix-ts-business`** — repository contracts + use-case factories over Effect. Repositories return `Effect<T, EntifixError>`; dependencies are injected as `Context.Tag`s (`EntityRepositoryTag`, `EntityLoadRequestTag`, `EntityLinkResolverTag`).
- **`entifix-ts-rest-client`** — turns an entity into an `EntityRepository` over HTTP; link-aware deserialization builds embedded relations and records foreign keys.
- **`entifix-react-*`** — `controls` (UI primitives), `integration` (Effect-aware hooks: `useDataLoading`, `useEntityLinkResolver`).

### How a load flows (products)

```
Product (business, @entity + EntityLink brand/category)
  └─ loadProductsUCFactory()  ── loads a page, then reloads any unresolved link via EntityLinkResolverTag
       └─ ProductTable (implementation/react)  ── renders resolved brand/category
            └─ ProductListClientPage (shells/next)  ── wires product REST adapter + useEntityLinkResolver
                 └─ /catalog/product (marketplace-admin-app)
```

The same use-case runs unchanged in any environment: only the composition root swaps the adapters behind the tags (REST on the web today, Mongo on a backend later). Foreign-key vs embedded links are handled transparently — see `packages/entifix/ts/core/src/entity-definition/links`.

### Catalog validation pages

`marketplace-admin-app` exposes `/catalog/{product,product-brand,product-category}` (nav bar in `app/catalog/layout.tsx`) backed by the `marketplace-admin-api` mock, which serves both link shapes: product `brand` is **embedded**, product `category` is a **foreign key** resolved on demand.

## Run tasks

To run the dev server for your app, use:

```sh
npx nx dev marketplace-app
```

To create a production bundle:

```sh
npx nx build marketplace-app
```

To see all available targets to run for a project, run:

```sh
npx nx show project marketplace-app
```

These targets are either [inferred automatically](https://nx.dev/concepts/inferred-tasks?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects) or defined in the `project.json` or `package.json` files.

[More about running tasks in the docs &raquo;](https://nx.dev/features/run-tasks?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

## Add new projects

While you could add new projects to your workspace manually, you might want to leverage [Nx plugins](https://nx.dev/concepts/nx-plugins?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects) and their [code generation](https://nx.dev/features/generate-code?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects) feature.

Use the plugin's generator to create new projects.

To generate a new application, use:

```sh
npx nx g @nx/next:app demo
```

To generate a new library, use:

```sh
npx nx g @nx/react:lib mylib
```

You can use `npx nx list` to get a list of installed plugins. Then, run `npx nx list <plugin-name>` to learn about more specific capabilities of a particular plugin. Alternatively, [install Nx Console](https://nx.dev/getting-started/editor-setup?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects) to browse plugins and generators in your IDE.

[Learn more about Nx plugins &raquo;](https://nx.dev/concepts/nx-plugins?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects) | [Browse the plugin registry &raquo;](https://nx.dev/plugin-registry?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

## Set up CI!

### Step 1

To connect to Nx Cloud, run the following command:

```sh
npx nx connect
```

Connecting to Nx Cloud ensures a [fast and scalable CI](https://nx.dev/ci/intro/why-nx-cloud?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects) pipeline. It includes features such as:

- [Remote caching](https://nx.dev/ci/features/remote-cache?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
- [Task distribution across multiple machines](https://nx.dev/ci/features/distribute-task-execution?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
- [Automated e2e test splitting](https://nx.dev/ci/features/split-e2e-tasks?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
- [Task flakiness detection and rerunning](https://nx.dev/ci/features/flaky-tasks?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

### Step 2

Use the following command to configure a CI workflow for your workspace:

```sh
npx nx g ci-workflow
```

[Learn more about Nx on CI](https://nx.dev/ci/intro/ci-with-nx#ready-get-started-with-your-provider?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

## Install Nx Console

Nx Console is an editor extension that enriches your developer experience. It lets you run tasks, generate code, and improves code autocompletion in your IDE. It is available for VSCode and IntelliJ.

[Install Nx Console &raquo;](https://nx.dev/getting-started/editor-setup?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

## Useful links

Learn more:

- [Learn more about this workspace setup](https://nx.dev/nx-api/next?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
- [Learn about Nx on CI](https://nx.dev/ci/intro/ci-with-nx?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
- [Releasing Packages with Nx release](https://nx.dev/features/manage-releases?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
- [What are Nx plugins?](https://nx.dev/concepts/nx-plugins?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

And join the Nx community:

- [Discord](https://go.nx.dev/community)
- [Follow us on X](https://twitter.com/nxdevtools) or [LinkedIn](https://www.linkedin.com/company/nrwl)
- [Our Youtube channel](https://www.youtube.com/@nxdevtools)
- [Our blog](https://nx.dev/blog?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
