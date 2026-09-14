/**
 * Installs catalogs for every spec in this package.
 *
 * ⚠️ **A setup file rather than a call per spec.** These components resolve copy
 * through `useT`, and `I18nProvider` needs a catalog installed before it can
 * build an i18next instance — so a spec that renders a table without this would
 * assert against raw keys and pass for the wrong reason.
 */
import { installSpecCatalogs } from './src/i18n/spec-support/catalogs';

installSpecCatalogs();
