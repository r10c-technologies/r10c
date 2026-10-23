import { app as enApp } from './en/app';
import { entity as enEntity } from './en/entity';
import { errors as enErrors } from './en/errors';
import { r10c as enR10c } from './en/r10c';
import { app as esApp } from './es/app';
import { entity as esEntity } from './es/entity';
import { errors as esErrors } from './es/errors';
import { r10c as esR10c } from './es/r10c';

/**
 * The copy r10c owns: its entities' labels, the error codes its services answer
 * with, the back office's own chrome, and the copy of the screens its shells
 * render (`r10c`).
 *
 * ⚠️ **Data only, and at the business layer, on purpose.** These three
 * namespaces used to ship inside the framework ([ADR 0059](../../../../../docs/adr/0059-entifix-leaves-the-repo.md)).
 * They live here rather than in `@r10c/i18n-catalog` because that package
 * composes them with the framework's catalogs and therefore imports the Next
 * shell — and a per-domain shell, which needs these labels in its own specs,
 * may not depend on a package at its own `shell:domain` level. Nothing here
 * imports anything, so anyone may.
 */
export const r10cCatalogs = {
  es: { entity: esEntity, errors: esErrors, app: esApp, r10c: esR10c },
  en: { entity: enEntity, errors: enErrors, app: enApp, r10c: enR10c },
} as const;

export type R10cOwnResources = (typeof r10cCatalogs)['es'];
