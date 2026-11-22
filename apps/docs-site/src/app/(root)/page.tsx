import Link from 'next/link';

import { docsCopy, SITE_LOCALES } from '../../content/copy';

/** Both languages, each named in itself. */
export default function LanguageChoice() {
  const copy = docsCopy('es');
  return (
    <main className="mx-auto flex max-w-prose flex-col gap-4 p-8">
      <h1 className="text-step-3 font-semibold">{copy.title}</h1>
      <p>{copy.languages.title}</p>
      <p lang="en">{docsCopy('en').languages.title}</p>
      <ul className="flex flex-col gap-2">
        {SITE_LOCALES.map(locale => (
          <li key={locale}>
            <Link
              href={`/${locale}/`}
              hrefLang={locale}
              lang={locale}
              className="inline-flex min-h-11 items-center text-primary underline"
            >
              {docsCopy(locale).languages[locale]}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
