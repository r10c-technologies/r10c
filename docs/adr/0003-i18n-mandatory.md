# 3. i18n is mandatory, and the build enforces it

- Status: Accepted
- Date: 2026-07-26

## Context

Every user-facing string in the fleet was an English literal compiled into a
bundle. There were no message catalogs, no `Accept-Language` handling, and all
three root layouts hardcoded `<html lang="en">`. The only locale-sensitive code
that existed — two `toLocaleString()` calls in `CellValue` — took no locale
argument, so it resolved against the _runtime's_ default: Node's on the server,
the visitor's in the browser. Those disagree, which made every date and number
cell a latent hydration mismatch.

The product requirement is Spanish first, English second. The engineering
requirement is stronger: adding a screen in English must not be possible by
accident. A convention that relies on reviewers noticing a hardcoded string is a
convention that decays.

## Decision

### `i18next` + `react-i18next`, not `next-intl`

`entifix-react-controls` is framework-agnostic by rule (docs/FRONTEND.md) and is
exercised in Storybook, which has no Next request scope. `next-intl`'s
`useTranslations` needs `NextIntlClientProvider` plus that scope.

**Rejected: `next-intl`.** Putting `next` into `entifix-react-controls` would
also be a _silent_ boundary violation — `next` is an npm dependency, not a
workspace project, so `@nx/enforce-module-boundaries` would not flag the edge.
It re-introduces the class of server-context/prerender coupling that broke
TanStack Form on Turbopack during EntityForm.

**Rejected: hand-rolled.** Plural rules and fallback chains are not worth
owning, and i18next's TypeScript module augmentation is what makes the typed-key
gate below possible at all.

### Catalogs are centralized, not co-located

All five namespaces (`controls`, `shell`, `errors`, `entity`, `app`) live in
`@r10c/entifix-ts-i18n`.

**Rejected: a catalog per owning package.** The typed-key augmentation has to
see every namespace from one module, and `entifix:tooling` may not import
`entifix:react` — a `controls` catalog living beside its components could never
be part of that declaration. Centralizing also makes the parity check a
single-directory scan.

The `en` catalogs are annotated with the `es` shape (`typeof import('../es/…')`),
so a key that exists in Spanish and not in English is a **compile** error.

### The package sits at `entifix:tooling`, and no new tag dimension was needed

`entifix:tooling` may depend only on `layer:utils`, and `entifix:react`,
`entifix:client` and `entifix:transactions` already list `entifix:tooling` as an
allowed dependency. `eslint.config.mjs` and `docs/_shared/layering.md` are
untouched — unlike ADR 0002, this change required no new ordering dimension.

A second entry point, `@r10c/entifix-ts-i18n/routing`, exports only the locale
type and the negotiation helpers. Next middleware runs on the edge, and
importing the barrel would pull the i18next runtime and all five catalogs into a
bundle that only reads a cookie and a header.

### Locale routing is a middleware rewrite, not an `app/[locale]` segment

An unprefixed path is redirected to `/<negotiated>/…`; a prefixed one is
rewritten onto the plain route tree with an `x-r10c-locale` request header that
`getRequestLocale()` reads.

**Rejected: a real `app/[locale]` route segment.** All three apps are dynamic
and auth-gated, so the static-rendering benefit does not apply, and it would
have cost a `locale` param threaded through every page in three apps. The cost
of this choice is that every internal `href` must go through `useLocaleHref()` /
`LocaleLink`; an unprefixed link still works, but the visitor pays a redirect
and can be bounced into whatever their cookie says.

### Entity labels are keys carried in metadata, resolved in the browser

`@accessor()` gained `labelKey`, `@entity()` gained `labelKey`/`pluralKey`, and
an enum member gained `enumLabelKey`. `describeEntityColumns` **carries** the key
and never resolves it.

This works because entity labels never cross the wire: `serializeEntity` emits
values only, and `describeEntityColumns` runs client-side against the shared
entity class. No metadata endpoint had to be invented.

**Rejected: resolving inside `describeEntityColumns`.** The same descriptors are
the server-side filter allowlist (`coerce-rsql.ts`), where a translated label is
meaningless — and `entifix:core` cannot reach the i18n layer anyway.

### Services answer with a code; the client renders it

A failure body is `{ error, code, detail }`. `error` stays English for logs;
`code` is a key in the shared `errors` catalog, which the rest client carries
onto `EntifixError.details` and the controls translate.

Only the authn error classes gained a real `code` field, because
`respondAuthError` used to pass their raw `message` to the browser — "not
allowed to assign that role" _was_ the UI copy, in every locale.

**Rejected: a `code` on `EntifixError` itself.** ~60 construction sites, most of
them developer-facing 400s from our own RSQL client. Those collapse to a single
`invalidQuery` code with `detail` retained.

### The gate is a lint rule plus typed keys

1. `react/jsx-no-literals` (`noStrings: true`) over every `.tsx` under a `src/`.
2. The i18next module augmentation: a misspelled key fails to compile.
3. `tools/check-i18n.mjs` in CI: es/en key parity, no empty values, and matching
   interpolation placeholders across locales.

**`ignoreProps` stays `true`.** Turning it off was the original intent — an
untranslated `aria-label` is invisible in review — but the rule cannot tell copy
from a machine value: it flags `field="id"`, `value=""` and `type="date"` as
loudly as `aria-label="Theme"`, and the allowlist needed to quiet those would
swallow the real findings.

## Consequences

- Spanish is the default and the fallback, so a missing `en` key degrades to
  readable Spanish rather than a raw key at the user.
- Dynamic keys — an entity's `labelKey`, a nav label held in a route table —
  cannot satisfy the typed-key signature. That trade is isolated in exactly two
  named, documented places: `useTranslateKey` (client) and
  `getServerTranslateKey` (server). Authored copy must keep going through
  `useT` / `getServerT` so a typo stays a compile error.
- Unit and e2e assertions are now in Spanish, matching what a user sees by
  default rather than what the code used to say.
- `CellValue` formats through an explicit locale, which removes the pre-existing
  server/browser hydration mismatch as a side effect.
- `UserIdentity.status` had to be declared as the enum it already is in the
  domain; as a bare accessor its type inferred to `string`, so the raw
  `active`/`suspended` token reached the user and the filter offered substring
  matching on it.
- Workspace tab captions are re-derived from the registry on render rather than
  read back from IndexedDB, so switching locale relabels open tabs.
- The Next server/edge half lives in its own package, `@r10c/shells-next-i18n`,
  rather than in `shells-next-common`, whose rollup output stamps a blanket
  `"use client"` banner that server components and edge middleware must not
  carry.

### A React library bundled into a package's `dist` must externalize it

`entifix-react-integration` builds with Vite, and its `rollupOptions.external`
listed React but not `react-i18next`. So the Vite build **inlined** react-i18next
_and_ `use-sync-external-store`'s CJS shim — whose module-scope `require('react')`
then threw against Turbopack's require stub, 500ing every SSR'd page.

The trap is that no alias can fix it: `next.config`'s `turbopack.resolveAlias`
and `serverExternalPackages` both act on module _resolution_, and after bundling
there is no module left to resolve — the `require` sits in our own `dist`. Adding
a React-adjacent runtime dependency to a bundled package means adding it to that
package's `external` list in the same commit.

### The lint rule cannot see copy inside expressions

`jsx-no-literals` reports JSX _children_. A ternary — `{saving ? 'Saving…' :
'Save'}` — is an expression, and three implementation-layer forms held
untranslated copy that way until they were found by hand. Reviewers should treat
a string literal inside JSX braces with the same suspicion as one outside them.

## Follow-ups (deliberately out of scope)

- A third locale. The mechanism is a catalog file and one entry in `LOCALES`;
  nothing else changes.
- Locale-aware sorting (`Intl.Collator`) in the Mongo adapter — server-side
  ordering is still byte-wise.
- `locale.supported` is seeded in config-service but not yet read at runtime;
  the supported set is currently the compile-time `LOCALES` constant.
- Translating the design-system playground pages, which are deliberately
  excluded: the English there is the specimen.
