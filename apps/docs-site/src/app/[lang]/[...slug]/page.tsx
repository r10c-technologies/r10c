import { docsMetadata, DocsPage } from '@entifix/docs-engine/ui';
import { notFound } from 'next/navigation';

import { isSiteLocale } from '../../../content/copy';
import { allParams, siteFor } from '../../../site';
import { PAGE_COMPONENTS } from '../../anchor';

interface Props {
  readonly params: Promise<{ lang: string; slug: string[] }>;
}

export const dynamicParams = false;

export const generateStaticParams = () => allParams();

const resolve = async ({ params }: Props) => {
  const { lang, slug } = await params;
  if (!isSiteLocale(lang)) notFound();
  return { site: siteFor(lang), slug };
};

export async function generateMetadata(props: Props) {
  const { site, slug } = await resolve(props);
  return docsMetadata(site, slug);
}

export default async function Page(props: Props) {
  const { site, slug } = await resolve(props);
  return <DocsPage site={site} slugs={slug} components={PAGE_COMPONENTS} />;
}
