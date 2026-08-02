import {
  type ConfigurationRepositoryTag,
  createEntityLinkResolver,
  type EntityLinkRegistration,
  type EntityLinkResolverTag,
} from '@r10c/entifix-ts-business';
import type { Context } from 'effect';
import { useMemo } from 'react';

export type { EntityLinkRegistration };
export { createEntityLinkResolver };

/**
 * React hook that memoizes an {@link EntityLinkResolverTag} context built from
 * the given repository adapters. This is the page-level seam for last-mile
 * wiring: a caller can register cached or state-backed adapters here without
 * touching the base adapters or the use-case.
 *
 * The assembly itself is `createEntityLinkResolver` in
 * `@r10c/entifix-ts-business` — nothing about it is React, and a server
 * component needs it without dragging this package's hooks along. Re-exported
 * here so existing client call sites keep one import.
 */
export function useEntityLinkResolver(
  configurationStore: Context.Context<ConfigurationRepositoryTag>,
  registrations: ReadonlyArray<EntityLinkRegistration>,
): Context.Context<EntityLinkResolverTag> {
  // Registrations are a static list per page; key the memo on the registered
  // constructor names so it stays stable across renders without depending on the
  // array literal's identity.
  const registrationKey = registrations
    .map(([entityConstructor]) => entityConstructor.name)
    .join('|');

  return useMemo(
    () => createEntityLinkResolver(configurationStore, registrations),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [configurationStore, registrationKey],
  );
}
