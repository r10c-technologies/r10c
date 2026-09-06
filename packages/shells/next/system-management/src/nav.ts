import {
  type GuardedNavSection,
  permissionForEntity,
  screenAddress,
} from '@r10c/business-ts-authz';
import { Configuration } from '@r10c/business-ts-configuration';

import { CONFIGURATION_LIST_HREF } from './client/configuration-list/configuration-list-client-page';

/**
 * This shell's contribution to a host's navigation.
 *
 * The permission is derived from the entity, not written out, so it cannot drift
 * from what config-service enforces on the route behind it. Only `super-admin`
 * holds `config:configuration:*`, so the whole section disappears for everyone
 * else — but that is presentation: config-service is what refuses the request.
 *
 * Copy lives in the shared `shell:` namespace rather than an app catalog, because
 * a second host must not have to re-translate these screens.
 */
export const SYSTEM_MANAGEMENT_NAV: GuardedNavSection[] = [
  {
    title: 'shell:systemManagement.nav.section',
    // Definiciones, with no exception made for it (ADR 0033): the operator
    // authors the row, it has no lifecycle, and every service references it.
    // That it is opened rarely is a fact about frequency, not about shape.
    type: 'master',
    items: [
      {
        label: 'shell:systemManagement.nav.configuration',
        href: CONFIGURATION_LIST_HREF,
        icon: '⚙',
        // Definiciones like every other screen this shell serves, so the tab
        // address carries the type rather than a `system:` prefix of its own —
        // one grammar for every surface (ADR 0042).
        workspace: screenAddress({ type: 'master', key: 'configuration' }),
        permission: permissionForEntity(Configuration, 'read'),
      },
    ],
  },
];
