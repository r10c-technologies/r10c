import { createRecordSearchRoute } from '@r10c/shells-next-common/server';

import { SEARCH_SOURCES } from '../../../lib/search-sources';

/**
 * `GET /api/search` — records matching a term, across every domain this host
 * mounts (ADR 0040).
 *
 * Never cached: the answer is scoped to one principal and one organization, and
 * the handler reads the session cookie to say so.
 */
export const dynamic = 'force-dynamic';

export const GET = createRecordSearchRoute({ sources: SEARCH_SOURCES });
