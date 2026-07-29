import { getServerTranslateKey } from '@r10c/shells-next-i18n/server';
import { NextResponse } from 'next/server';

import { workspaceMenu } from '../../../lib/nav';
import { navRoles } from '../../../lib/roles';

/**
 * The workspace navigation menu, derived from the same `lib/nav` definition the
 * sidebar renders and filtered by the caller's roles. Sharing one definition is
 * the point: these two lists have to agree, and keeping them apart guaranteed
 * they eventually would not.
 */
export async function GET() {
  // Unbound: the nav table carries its own `app:` / `shell:` prefixes.
  const t = await getServerTranslateKey();
  return NextResponse.json({ sections: workspaceMenu(await navRoles(), t) });
}
