import { getServerT } from '@r10c/shells-next-i18n/server';

/** Where middleware lands an authenticated visitor; still a placeholder. */
export default async function AdminHomePage() {
  const t = await getServerT('app');
  return <div className="flex flex-col gap-4">{t('admin.nav.dashboard')}</div>;
}
