import { docsMetadata, DocsPage } from '@entifix/docs-engine/ui';
import { notFound } from 'next/navigation';

import { AUDIENCE_FOLDER } from '../../content/audiences';
import { isSiteLocale } from '../../content/copy';
import { siteFor } from '../../site';
import { PAGE_COMPONENTS } from '../anchor';

interface Props {
  readonly params: Promise<{ lang: string }>;
}

/** A language's home is the four doors' index. */
const HOME = [AUDIENCE_FOLDER];

const resolve = async ({ params }: Props) => {
  const { lang } = await params;
  if (!isSiteLocale(lang)) notFound();
  return siteFor(lang);
};

export async function generateMetadata(props: Props) {
  return docsMetadata(await resolve(props), HOME);
}

export default async function Home(props: Props) {
  return (
    <DocsPage
      site={await resolve(props)}
      slugs={HOME}
      components={PAGE_COMPONENTS}
    />
  );
}
