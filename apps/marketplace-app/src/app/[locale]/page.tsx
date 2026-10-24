import { homeMetadata, HomePage } from '@r10c/shells-next-marketplace/server';

import { type LocaleRouteProps, requireLocale } from './locale-param';

export async function generateMetadata({ params }: LocaleRouteProps) {
  return homeMetadata(await requireLocale(params));
}

export default async function Index({ params }: LocaleRouteProps) {
  return <HomePage locale={await requireLocale(params)} />;
}
