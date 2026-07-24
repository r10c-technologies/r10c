'use client';

import { useRouter } from 'next/navigation';
import { createContext, type ReactNode, useContext, useMemo } from 'react';

import { useTabsStore } from './tabs-store';

/**
 * Navigation intent, decoupled from the host. A page says "go to this list" or
 * "open this entity"; the host decides how. In a route the destination is a URL
 * push; in the workspace it is a tab open/focus. A page calls {@link useEntityNav}
 * and never learns which host it is in.
 */
export interface EntityNav {
  toList(entityKey: string): void;
  toEntity(entityKey: string, id: string): void;
}

const EntityNavContext = createContext<EntityNav | null>(null);

/** Route host: navigation is a canonical URL push under `/catalog`. */
export function useRouteEntityNav(basePath = '/catalog'): EntityNav {
  const router = useRouter();
  return useMemo(
    () => ({
      toList: entityKey => router.push(`${basePath}/${entityKey}`),
      toEntity: (entityKey, id) =>
        router.push(`${basePath}/${entityKey}/${id}`),
    }),
    [router, basePath],
  );
}

/** Tab host: navigation opens or focuses a workspace tab. */
export function useTabEntityNav(): EntityNav {
  const open = useTabsStore(state => state.open);
  return useMemo(
    () => ({
      toList: entityKey =>
        open({ param: `catalog:${entityKey}`, title: entityKey }),
      toEntity: (entityKey, id) =>
        open({
          param: `entity:${entityKey}:${id}`,
          title: `${entityKey} #${id}`,
        }),
    }),
    [open],
  );
}

export function EntityNavProvider({
  value,
  children,
}: {
  value: EntityNav;
  children: ReactNode;
}) {
  return (
    <EntityNavContext.Provider value={value}>
      {children}
    </EntityNavContext.Provider>
  );
}

/**
 * The active {@link EntityNav}. Falls back to route navigation when no provider
 * is mounted, so a page rendered as a plain route (its default host) navigates
 * by URL without any wiring; the workspace wraps its tabs in a tab-nav provider.
 */
export function useEntityNav(): EntityNav {
  const provided = useContext(EntityNavContext);
  const routeNav = useRouteEntityNav();
  return provided ?? routeNav;
}
