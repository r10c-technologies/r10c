import { type Permission, permissionMatches } from '@entifix/authz';
import {
  ROLE_PERMISSIONS,
  SERVICE_CROSSING_PERMISSIONS,
} from '@r10c/business-ts-authz-grants';
import { FLOW_RECIPES } from '@r10c/shells-effect-flow-catalog';
import { AUTH_NAV } from '@r10c/shells-next-auth/server';
import { FULFILMENT_NAV } from '@r10c/shells-next-fulfilment/server';
import { storePaths } from '@r10c/shells-next-marketplace';
import { MARKETPLACE_ADMIN_NAV } from '@r10c/shells-next-marketplace-admin/server';
import { ORDER_NAV } from '@r10c/shells-next-order/server';
import { SALES_NAV } from '@r10c/shells-next-sales/server';
import { SETTLEMENT_NAV } from '@r10c/shells-next-settlement/server';
import { STOCK_NAV } from '@r10c/shells-next-stock/server';
import { SYSTEM_MANAGEMENT_NAV } from '@r10c/shells-next-system-management';

import type { World } from './resolve.js';

/**
 * The back office's navigation as `apps/back-office-app/src/lib/nav.ts`
 * composes it — the same fragments, so a screen exists here exactly when the
 * sidebar can reach it. An item with no `workspace` (the account pages) names
 * no screen.
 */
const NAV = [
  ...MARKETPLACE_ADMIN_NAV,
  ...STOCK_NAV,
  ...SALES_NAV,
  ...SETTLEMENT_NAV,
  ...ORDER_NAV,
  ...FULFILMENT_NAV,
  ...SYSTEM_MANAGEMENT_NAV,
  ...AUTH_NAV,
];

/** `operation:product-order:abc` and `operation:product-order` are one screen. */
const withoutId = (address: string) => address.split(':').slice(0, 2).join(':');

/**
 * What `@r10c/slices` reads from the tree, handed in rather than imported: that
 * project is `layer:app`, which a source file may not depend on, and a spec may
 * (`type:testing`). The spec supplies it, and so does any later consumer.
 */
export interface SliceFacts {
  readonly resources: ReadonlyMap<string, string>;
  readonly useCases: readonly {
    readonly entity: string;
    readonly key: string;
    readonly recipe?: string;
    readonly reachable: boolean;
  }[];
  /** Each slice's domains, and its exposed API lines already expanded to `METHOD /path`. */
  readonly slices: readonly {
    readonly domains: readonly string[];
    readonly endpoints: readonly string[];
  }[];
}

export const realWorld = ({
  resources,
  useCases,
  slices,
}: SliceFacts): World => {
  // Without the bare `*:*:*`: it grants every string, so counting it would make
  // "some role holds this permission" true of a typo. Verbs only the operator
  // holds are named explicitly in the table, as `role-permissions.ts` explains.
  const held = Object.values(ROLE_PERMISSIONS)
    .flat()
    .filter(grant => grant !== '*:*:*');

  return {
    useCases: useCases.map(u => ({
      resource: resources.get(u.entity) ?? `unresolved:${u.entity}`,
      key: u.key,
      ...(u.recipe === undefined ? {} : { recipe: u.recipe }),
      reachable: u.reachable,
    })),
    entities: new Set(resources.values()),
    serves: (domain, entityKey, method) =>
      slices.some(
        slice =>
          slice.domains.includes(domain) &&
          slice.endpoints.includes(`${method} /api/${entityKey}`),
      ),
    recipes: new Set(Object.keys(FLOW_RECIPES)),
    granted: permission =>
      held.some(grant => permissionMatches(grant, permission as Permission)),
    crossing: new Set<string>(SERVICE_CROSSING_PERMISSIONS),
    screens: new Set([
      ...NAV.flatMap(section =>
        section.items.flatMap(item =>
          item.workspace === undefined ? [] : [withoutId(item.workspace)],
        ),
      ),
      ...Object.keys(storePaths).map(key => `storefront:${key}`),
    ]),
  };
};
