import { r10cCatalogs } from '@r10c/business-ts-i18n';

/** The two trees the site is exported as: `/es/…` and `/en/…`. */
export const SITE_LOCALES = ['es', 'en'] as const;
export type SiteLocale = (typeof SITE_LOCALES)[number];

export const isSiteLocale = (value: string): value is SiteLocale =>
  (SITE_LOCALES as readonly string[]).includes(value);

/** The site's own words, from the `app` catalog's `docs` block. */
export const docsCopy = (locale: SiteLocale) => r10cCatalogs[locale].app.docs;
export type DocsCopy = ReturnType<typeof docsCopy>;

interface EntityCopy {
  readonly label: string;
  readonly plural?: string;
  readonly form?: { readonly newTitle?: string };
  readonly useCases?: Readonly<Record<string, string>>;
}

/** One entity's catalog block, by its `@entity({ key })`. */
export const entityCopy = (
  locale: SiteLocale,
  entityKey: string,
): EntityCopy | undefined =>
  (r10cCatalogs[locale].entity as unknown as Record<string, EntityCopy>)[
    entityKey
  ];

const camel = (kebab: string) =>
  kebab.replaceAll(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());

/**
 * The words for one action on an entity, from the copy the verb already shows
 * on its button (ADR 0080 §7): the catalog's `useCases` entry under the
 * action's own name, kebab or camel as the catalog wrote it. A `write` is the
 * entity's form title, since a save is the form; a flow recipe that opens the
 * entity (`checkout`) is the same title for the same reason.
 */
export const actionTitle = (
  locale: SiteLocale,
  entityKey: string,
  action: string,
): string | undefined => {
  const entity = entityCopy(locale, entityKey);
  if (entity === undefined) return undefined;
  const verb = entity.useCases?.[action] ?? entity.useCases?.[camel(action)];
  if (verb !== undefined) return verb;
  if (action === 'write' || action === 'checkout') return entity.form?.newTitle;
  return undefined;
};

/** `<domain>:<entityKey>` → the entity's label, or the key when none. */
export const entityLabel = (locale: SiteLocale, reference: string): string => {
  const key = reference.split(':')[1] ?? reference;
  return entityCopy(locale, key)?.label ?? key;
};
