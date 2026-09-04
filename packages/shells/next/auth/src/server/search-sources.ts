import { UserIdentity } from '@r10c/business-ts-authn';
import {
  defineRecordSearchSource,
  type RecordSearchSource,
} from '@r10c/shells-next-common/server';

import { AUTH_SERVICE_URL } from './session';

/**
 * People, as a source the palette can search (ADR 0040).
 *
 * Beside the screens that render them, like `AUTH_NAV` — a host that drops the
 * auth shell drops the ability to search users with it, which is the point.
 *
 * `AUTH_SERVICE_URL` is reused rather than re-derived: this is the one place in
 * the fleet that knows where auth-service listens, and a second copy of the
 * default is how a search starts asking a port nothing is on while sign-in keeps
 * working.
 *
 * ⚠️ This source only became honest when auth-service started parsing `rsql`.
 * Before that its list route read `page`/`pageSize` and silently ignored every
 * filter, so a search for a name would have returned the first page of *every*
 * user, presented as matches.
 */
export const AUTH_SEARCH_SOURCES: readonly RecordSearchSource[] = [
  defineRecordSearchSource({
    entityConstructor: UserIdentity,
    baseUrl: AUTH_SERVICE_URL,
    searchProperty: 'displayName',
    labelProperty: 'displayName',
    // The role, not an identifier: an email is a credential-adjacent value and
    // the palette is a broad surface. `identifiers` is a collection anyway, so
    // it has no scalar form to show on a single line.
    sublabelProperty: 'role',
    labelKey: 'entity:user-identity.plural',
    href: id => `/users/${id}`,
  }),
];
