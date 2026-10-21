/**
 * r10c's locale declaration, for every spec here.
 *
 * entifix assumes no locale of its own (entifix#35), so a page rendered with
 * no provider resolves to whatever the host declared — and these specs assert
 * the Spanish default r10c ships, in a `/es/…` href among other places.
 */
import '@r10c/business-ts-i18n/locales';
