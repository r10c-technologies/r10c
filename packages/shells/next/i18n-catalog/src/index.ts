import {
  r10cCatalogs,
  type R10cOwnResources,
} from '@r10c/business-ts-i18n';
import {
  controlsCatalogs,
  type ControlsResources,
  registerFallbackCatalog,
} from '@r10c/entifix-react-controls';
import { defineCatalogs } from '@r10c/entifix-ts-i18n';
import {
  shellCatalogs,
  type ShellResources,
} from '@r10c/shells-next-common';

/**
 * r10c's catalogs, and the composition of entifix's with them.
 *
 * ⚠️ **Three of these namespaces used to live inside the framework, and two of
 * them were never framework copy.** `entity` names *r10c's* entities — a
 * parameter, a product offering, a sales channel — and `app` held
 * `'r10c Admin'` and `'Back-office del marketplace r10c'`. `errors` is the code
 * vocabulary this fleet's services answer with. A framework that ships any of
 * them has decided its adopters' product for them
 * ([ADR 0059](../../../../../docs/adr/0059-entifix-leaves-the-repo.md)).
 *
 * What entifix does ship is the copy for the things it actually renders:
 * `controls` with the agnostic entity UI, `shell` with the chrome. Those merge
 * in below.
 */
export const R10C_RESOURCES = {
  es: {
    ...controlsCatalogs.es,
    ...shellCatalogs.es,
    ...r10cCatalogs.es,
  },
  en: {
    ...controlsCatalogs.en,
    ...shellCatalogs.en,
    ...r10cCatalogs.en,
  },
} as const;


/**
 * The single typed-key shape, composed here because only a host can compose it:
 * TypeScript permits exactly one `declare module 'i18next'` per compilation, so
 * a second one anywhere in the graph is `TS2717`.
 */
export type Resources = ControlsResources & ShellResources & R10cOwnResources;

export type Namespace = keyof Resources;

export const NAMESPACES = [
  'controls',
  'shell',
  'errors',
  'entity',
  'app',
] as const satisfies readonly Namespace[];

export const DEFAULT_NS = 'controls' satisfies Namespace;

/**
 * The typed-key gate. Binding `CustomTypeOptions` to the Spanish shape makes
 * `t('controls:table.acions')` a compile error in every consumer — which is what
 * turns "translate your strings" from a convention into something a build can
 * enforce.
 *
 * It lives in this barrel rather than a standalone `.d.ts` so it is always part
 * of the emitted declaration graph, and so it can never be tree-shaken away from
 * a consumer that only imports `R10C_RESOURCES`.
 */
// ⚠️ Load-bearing, though it imports nothing. A `declare module` is resolved
// from *this* file's directory, so `i18next` must be a dependency of this
// package — and `@nx/dependency-checks` does not count an augmentation as a
// use, so without this line it reports the dependency unused. Type-only, so it
// is erased and adds nothing to a bundle.
import type {} from 'i18next';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'controls';
    resources: Resources;
  }
}

/**
 * Installs the catalogs above into `@entifix/i18n`.
 *
 * Run at module scope, and that is deliberate: this package exists for exactly
 * one purpose, so importing it is the act of installing. `sideEffects: true` in
 * the manifest keeps a bundler from dropping it. Idempotent, so an app that
 * imports it from both a server entry and a client provider installs once.
 */
defineCatalogs({
  resources: R10C_RESOURCES,
  namespaces: NAMESPACES,
  defaultNS: DEFAULT_NS,
});

/**
 * And the same three namespaces for a component rendered with no provider.
 *
 * Before ADR 0059 the fallback instance carried every catalog, so a screen that
 * forgot its provider still rendered r10c's labels in Spanish. The framework's
 * fallback now knows only the copy the framework ships; registering r10c's here
 * keeps that failure mode the same one it always was.
 */
for (const namespace of ['entity', 'errors', 'app'] as const) {
  registerFallbackCatalog(namespace, {
    es: r10cCatalogs.es[namespace],
    en: r10cCatalogs.en[namespace],
  });
}
