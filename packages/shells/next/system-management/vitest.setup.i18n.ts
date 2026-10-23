/**
 * r10c's locale declaration, for every spec here.
 *
 * entifix assumes no locale of its own (entifix#35), so a page rendered with
 * no provider resolves to whatever the host declared — and these specs assert
 * the Spanish default r10c ships, in a `/es/…` href among other places.
 */
import '@r10c/business-ts-i18n/locales';

import { registerFallbackCatalog } from '@entifix/react-controls';
import { r10cCatalogs } from '@r10c/business-ts-i18n';

// The screens' own copy lives in r10c's namespace since entifix 0.6.0 stopped
// shipping it in `shell`, so a spec rendering one needs it registered too.
for (const namespace of ['entity', 'errors', 'app', 'r10c'] as const) {
  registerFallbackCatalog(namespace, {
    es: r10cCatalogs.es[namespace],
    en: r10cCatalogs.en[namespace],
  });
}
