import { isLocale, type Locale } from '@r10c/entifix-ts-i18n/routing';
import { notFound } from 'next/navigation';

/**
 * Narrows the `[locale]` route param, 404ing on anything the middleware would
 * never have produced (`/de/...`, typed by hand).
 *
 * Every page does this, so it lives once. It stays in the app rather than the
 * shell because the segment is the app's route-tree decision — the shell's
 * components take a `Locale` and never learn where it came from.
 */
export async function requireLocale(
  params: Promise<{ locale: string }>,
): Promise<Locale> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return locale;
}

export interface LocaleRouteProps {
  params: Promise<{ locale: string }>;
}
