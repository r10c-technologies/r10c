import type { EntityMetadataSource } from '@entifix/core';
import { makeEntityMetadataSource } from '@entifix/rest';

export interface AuthAdapters {
  /** The served affordance document for a user record. */
  readonly metadata: EntityMetadataSource;
}

/**
 * A hand-written URL rather than the adapters' config-driven `compose` mode,
 * because this shell proxies auth-service through its host's own origin.
 *
 * Built once at module scope: it holds no state, and a new object per call would
 * change nothing but churn.
 */
const metadata = makeEntityMetadataSource({
  url: name => `/api/${name}/$metadata`,
});

/**
 * The transports this shell's screens talk through, and the one module here
 * that names one.
 *
 * Unlike the other domain shells there is no adapters context: the user screens
 * read records with plain same-origin `fetch`, so the only transport worth
 * composing is the metadata source, and a module-level factory is all that
 * needs.
 */
export function createClientAdapters(): AuthAdapters {
  return { metadata };
}
