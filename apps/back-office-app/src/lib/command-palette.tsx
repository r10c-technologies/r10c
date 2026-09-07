'use client';

import { UserIdentity } from '@r10c/business-ts-authn';
import { makeEntityMetadataSource } from '@r10c/entifix-ts-rest-client';
import {
  CommandPaletteHost,
  type NavSection,
  type PaletteCommand,
  type UseCaseCommandEntity,
} from '@r10c/shells-next-common';

/**
 * Built once at module scope, not per render: it holds no state, and a new
 * object every render would change nothing but churn. Same construction as
 * `user-single-page.tsx` — a hand-written URL rather than the adapters'
 * config-driven mode, because this host proxies auth-service through its own
 * origin.
 */
const metadataSource = makeEntityMetadataSource({
  url: name => `/api/${name}/$metadata`,
});

/**
 * End every session but this one.
 *
 * The route is `POST /api/auth/sessions` on this origin, which the auth shell
 * proxies to auth-service's `revoke-others`. It has existed since sessions were
 * built and had **no caller at all** — the account screen only revokes one row
 * at a time — which is what made `sign-out-others` a real verb to declare rather
 * than one invented to fill ADR 0035's empty `unbound` cell.
 */
const signOutOthers = async (): Promise<void> => {
  const response = await fetch('/api/auth/sessions', {
    method: 'POST',
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`sign-out-others failed with ${response.status}`);
  }
};

/**
 * ⚠️ **Module scope, deliberately.** `useUseCaseSources` calls one hook per
 * entry, so an array rebuilt each render would change the hook count. The same
 * constraint `makeEntityCrud`'s `links` carries, and for the same reason.
 *
 * One entity today. `UserIdentity` is the only class in the fleet declaring an
 * `unbound` verb, and the group renders exactly what `$metadata` says this
 * caller may invoke — so a second one is a line here, not a change to the
 * palette.
 */
const USE_CASE_ENTITIES: readonly UseCaseCommandEntity[] = [
  {
    entityConstructor: UserIdentity,
    metadataSource,
    handlers: { 'sign-out-others': signOutOthers },
  },
];

export interface BackOfficeCommandPaletteProps {
  readonly commands: readonly PaletteCommand[];
  readonly nav: NavSection[];
}

/**
 * The back office's palette, wired to this host's own verbs.
 *
 * It exists in the app rather than in the shell because of what it carries:
 * an entity constructor and a handler function, neither of which survives the
 * server→client boundary as a prop. The chrome is a server component, so the
 * only way the palette can hold them is to be a client module that imports them
 * itself — which is also what keeps `shells-next-common` from naming any
 * domain's entities.
 */
export function BackOfficeCommandPalette({
  commands,
  nav,
}: BackOfficeCommandPaletteProps) {
  return (
    <CommandPaletteHost
      commands={commands}
      nav={nav}
      useCaseEntities={USE_CASE_ENTITIES}
    />
  );
}
