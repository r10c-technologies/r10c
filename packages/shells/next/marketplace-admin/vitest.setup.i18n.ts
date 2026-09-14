/**
 * Registers r10c's copy with the controls package's no-provider fallback, for
 * every spec in this shell.
 *
 * ⚠️ **Needed since ADR 0059, and deliberately a setup file.** These specs
 * render screens with no `I18nProvider`, exactly as they always did — but the
 * fallback used to carry every catalog baked into the framework, and now carries
 * only the copy the framework ships (`controls`, and `shell` once the Next shell
 * is loaded). The field labels a screen shows are r10c's `entity` namespace, so
 * without this a spec would find `product-brand.fields.name` where it expects
 * "Nombre" and fail — or worse, a looser assertion would pass for the wrong
 * reason.
 *
 * ⚠️ **It must not import `@entifix/next-shell`.** A setup file runs before
 * each spec's `vi.mock` calls take effect, so loading that barrel here binds its
 * components to the real `next/navigation` and every render throws `invariant
 * expected app router to be mounted`. It does not need to: the Next shell
 * registers its own `shell` namespace the moment a spec imports it.
 */
import { registerFallbackCatalog } from '@entifix/react-controls';
import { r10cCatalogs } from '@r10c/business-ts-i18n';

for (const namespace of ['entity', 'errors', 'app'] as const) {
  registerFallbackCatalog(namespace, {
    es: r10cCatalogs.es[namespace],
    en: r10cCatalogs.en[namespace],
  });
}
