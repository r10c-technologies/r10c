import type { EntityLinkSourceConfig } from '@r10c/entifix-react-integration';
import type {
  ConfigurationRepositoryTag,
  EntityRepositoryTag,
} from '@r10c/entifix-ts-business';
import type {
  Entity,
  EntityConstructor,
  EntityFieldDescriptor,
  EntityLinkDraft,
} from '@r10c/entifix-ts-core';
import type { Resources } from '@r10c/entifix-ts-i18n';
import type { Context } from 'effect/Context';
import type { ReactElement, ReactNode } from 'react';

/**
 * The `entity` catalog keys that carry **both** form titles.
 *
 * Derived from the Spanish catalog rather than written out, so the union is the
 * catalog: an entity whose subtree has no `form.editTitle`/`form.newTitle`
 * cannot be handed to {@link makeEntityCrud} at all, and adding a reference
 * entity therefore starts by adding its copy to both locales. That is the whole
 * i18n gate for this factory — `@r10c/i18n-check` scans only
 * `packages/business/ts` for `@useCase()` decorators and never `.tsx`, so a
 * runtime key here would be checked by nothing.
 *
 * Keeping the key typed is what lets the generated form call `useT('entity')`
 * with a template literal and still fail the build on a typo, instead of
 * reaching for the `useTranslateKey` escape hatch that authored copy must not
 * use. `AccountLabelKey` in `../session/account-links.ts` is the same trick
 * written out by hand; this one cannot drift because it is computed.
 */
export type EntityCatalogKey = {
  [K in keyof Resources['entity']]: Resources['entity'][K] extends {
    form: { editTitle: string; newTitle: string };
  }
    ? K
    : never;
}[keyof Resources['entity']] &
  string;

/**
 * A relation the generated form edits with a picker.
 *
 * The target is named here rather than derived, because the common case is a
 * **plain foreign key**: when the target lives in another slice's store a typed
 * `EntityLink` is both an illegal import and a cross-store join, so the member
 * is a bare `string` (`ProductSpecification.brandId` into `catalog-reference`)
 * and its `@accessor()` has no vocabulary for "the target's name". Hence
 * `labelProperty`/`searchProperty` are stated at the call site instead of being
 * left to `describeEntityColumns`' `'name'` default, which happens to be right
 * today and states nothing.
 *
 * `searchProperty` must be `filterable` on the **target** or the service answers
 * `400`; `useEntityLinkSource` throws at render rather than letting that surface
 * as an empty suggestion list.
 */
export interface EntityCrudLink<TAdapters> {
  /** The owning entity's accessor name, e.g. `'brandId'`. */
  readonly field: string;
  readonly entityConstructor: EntityConstructor<Entity>;
  /**
   * Which adapter holds the **target's** repository. Often a different service
   * than the record's own: `catalog-reference` is another slice's store, so
   * resolving an id goes through that domain's own read path.
   */
  readonly repository: AdapterKey<TAdapters, Context<EntityRepositoryTag>>;
  /** Defaults to `'name'`. */
  readonly labelProperty?: string;
  /** Defaults to `'name'`. Must be `filterable` on the target. */
  readonly searchProperty?: string;
}

/** The keys of `TAdapters` whose value is assignable to `TValue`. */
export type AdapterKey<TAdapters, TValue> = {
  [K in keyof TAdapters]: TAdapters[K] extends TValue ? K : never;
}[keyof TAdapters];

export interface EntityCrudOptions<TAdapters> {
  /** The domain shell's adapters hook, e.g. `useMarketplaceAdminAdapters`. */
  readonly useAdapters: () => TAdapters;
  /** Route prefix for both pages, e.g. `'/catalog/product-brand'`. */
  readonly basePath: string;
  /**
   * The entity's `entity` catalog key. Asserted against `@entity({ key })` at
   * factory time — the two are the same string by convention
   * (`entity:product-brand.label` mirrors `key: 'product-brand'`), and letting
   * them drift would title a form after a different entity.
   */
  readonly catalogKey: EntityCatalogKey;
  /** Which adapter holds this entity's own repository. */
  readonly repository: AdapterKey<TAdapters, Context<EntityRepositoryTag>>;
  readonly configuration: AdapterKey<
    TAdapters,
    Context<ConfigurationRepositoryTag>
  >;
  /**
   * Members the form keeps but does not show — `id` always, plus anything a
   * transaction assigns. A hidden member still round-trips: it is dropped from
   * the rendered fields, not from the draft, so `reconstructEntity` carries it
   * back out of the seeded values.
   */
  readonly hiddenFields?: readonly string[];
  /** `<EntityColumn>` overrides for the list, for presentation metadata cannot express. */
  readonly columns?: ReactNode;
  /** Frozen at factory time — see `use-entity-link-sources.ts`. */
  readonly links?: readonly EntityCrudLink<TAdapters>[];
}

/**
 * The serialisable form draft a workspace host autosaves — keyed by the
 * entity's accessor names, so it round-trips through `useEntityForm` and
 * `reconstructEntity` without translation.
 */
export type EntityCrudDraft = EntityLinkDraft;

/**
 * Props both hosts pass. A route host passes none — the slug comes from the URL
 * and a save returns to the list; the workspace tab host passes all of them.
 */
export interface EntityCrudSingleViewProps {
  /** Defaults to the `[slug]` route param. */
  readonly slug?: string;
  /** Defaults to navigating back to the list. */
  readonly onSaved?: () => void;
  readonly onDeleted?: () => void;
  /** Seed the fields from a persisted draft instead of the record. */
  readonly initialDraft?: EntityCrudDraft;
  /** Called on every edit, so the host can autosave. */
  readonly onDraftChange?: (draft: EntityCrudDraft) => void;
}

/**
 * What the factory returns: a **named descriptor**, not four loose components.
 *
 * The identity fields are here so the workspace registry and the nav can be
 * derived from a list of these rather than from the hand-written const maps and
 * the literal ternary they replace (#141).
 */
export interface EntityCrud<TEntity extends Entity> {
  readonly entityConstructor: EntityConstructor<TEntity>;
  /** `@entity({ key })`, which is also `catalogKey` and the tab address payload. */
  readonly entityKey: EntityCatalogKey;
  readonly basePath: string;
  readonly ListPage: () => ReactElement;
  readonly SingleViewPage: (props?: EntityCrudSingleViewProps) => ReactElement;
}

/**
 * A picker's transport with its context tags erased.
 *
 * The factory cannot preserve one type parameter per link — the pages that
 * build these know their adapters, the generated form only forwards them — and
 * `EntityForm.linkSources` is already `Record<string, EntityLinkSource<any>>`
 * for the same reason.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyEntityLinkSourceConfig = EntityLinkSourceConfig<Entity, any>;

/**
 * One picker, resolved: the descriptor computed once at factory time, and the
 * use-cases plus adapter context the page builds per render.
 */
export interface EntityCrudLinkSource {
  readonly field: string;
  readonly descriptor: EntityFieldDescriptor;
  readonly config: AnyEntityLinkSourceConfig;
}
