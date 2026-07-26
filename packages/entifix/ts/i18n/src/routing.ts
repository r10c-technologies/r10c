/**
 * The locale-routing surface, free of i18next and of every catalog.
 *
 * Exists as its own entry point because Next middleware runs on the edge:
 * importing the package barrel would pull the i18next runtime and all five
 * namespaces into a bundle that only ever needs to read a cookie and a header.
 */
export * from './locales';
export * from './negotiate';
