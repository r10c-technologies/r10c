'use client';

import { parseScreenPayload } from '@r10c/business-ts-authz';
import { UserDetailPage, UsersPage } from '@r10c/shells-next-auth';
import {
  type TabKind,
  TabRegistry,
  wizardTabKind,
} from '@r10c/shells-next-common';
import {
  MARKETPLACE_ADMIN_CRUDS,
  PRODUCT_SETUP_SURFACE,
  ProductSetupWizard,
} from '@r10c/shells-next-marketplace-admin';
import { ConfigurationListClientPage } from '@r10c/shells-next-system-management';
import type { ReactNode } from 'react';

import { EntityEditorTab } from './entity-tab';

/**
 * Every screen a `master:` tab can open, derived from the generated catalogs.
 *
 * This was two hand-written const maps and a third in `entity-tab.tsx`, all
 * keyed by the same three entity keys — against the 28 entities ADR 0022 fixes
 * for v1. Nothing failed when one was missed: a key absent from the list map
 * opened a tab onto nothing, and one absent from the editor map made the
 * sidebar's open-in-workspace control silently do nothing at all (#133). The
 * list, the editor, the tab caption and the route now all come from the
 * `EntityCrud` descriptor the pages themselves were generated from.
 *
 * `Configuration` is the one hand-built entry, and it earns the exception: its
 * screen is not `makeEntityCrud` output and it has no record tab — there is no
 * single-configuration page to open. A screen that genuinely cannot be derived
 * is a line here; an entity that can is not.
 */
const MASTER_LISTS: Record<
  string,
  { titleKey: string; render: () => ReactNode }
> = {
  ...Object.fromEntries(
    MARKETPLACE_ADMIN_CRUDS.map(crud => [
      crud.entityKey,
      {
        // The entity's own `@entity({ pluralKey })`, so a tab caption cannot
        // drift from the heading of the table inside it.
        titleKey: crud.entityPluralKey,
        render: () => <crud.ListPage />,
      },
    ]),
  ),
  configuration: {
    titleKey: 'shell:systemManagement.nav.configuration',
    render: () => <ConfigurationListClientPage />,
  },
  'user-identity': {
    titleKey: 'entity:user-identity.plural',
    render: () => <UsersPage />,
  },
};

const MASTER_RECORDS: Record<
  string,
  { labelKey: string; Page: typeof UserDetailPage }
> = {
  ...Object.fromEntries(
    MARKETPLACE_ADMIN_CRUDS.map(crud => [
      crud.entityKey,
      { labelKey: crud.entityLabelKey, Page: crud.SingleViewPage },
    ]),
  ),
  // Hand-written rather than generated — auth-service's PATCH accepts two
  // aspects and nothing else — but it takes the same props every generated
  // single view does, which is what lets it be a record tab at all.
  'user-identity': {
    labelKey: 'entity:user-identity.label',
    Page: UserDetailPage,
  },
};

/**
 * The one tab kind: `master:<key>` for a list, `master:<key>:<id>` for a record.
 *
 * Three kinds — `catalog:`, `entity:` and `system:` — collapse into this one,
 * because all three addressed Definiciones screens (ADR 0033) and the taxonomy
 * is what the prefix should name. The list and the record are not different
 * kinds; they are the same screen with and without a record, which is exactly
 * what the optional id in the payload says.
 */
const masterKind: TabKind<{ key: string; id?: string }> = {
  kind: 'master',
  match: payload => {
    const parsed = parseScreenPayload(payload);
    if (parsed === null) return null;
    const known =
      parsed.id === undefined
        ? parsed.key in MASTER_LISTS
        : parsed.key in MASTER_RECORDS;
    return known ? parsed : null;
  },
  toParam: addr => (addr.id === undefined ? addr.key : `${addr.key}:${addr.id}`),
  title: (addr, translate) =>
    addr.id === undefined
      ? translate(MASTER_LISTS[addr.key].titleKey)
      : `${translate(MASTER_RECORDS[addr.key].labelKey)} #${addr.id}`,
  render: addr =>
    addr.id === undefined ? (
      MASTER_LISTS[addr.key].render()
    ) : (
      <EntityEditorTab
        entityKey={addr.key}
        id={addr.id}
        Page={MASTER_RECORDS[addr.key].Page}
      />
    ),
};

/**
 * Every guided screen a `wizard:` tab can open.
 *
 * The third address segment is the **step**, which is the one thing ADR 0045
 * changed about the grammar — under `master:` it is a record. The flow itself
 * decides whether to honour it: `goTo` moves only to a step already on the path,
 * so an address naming a step nobody walked opens the wizard at its beginning
 * rather than skipping the validation in between.
 */
const wizardKind = wizardTabKind({
  [PRODUCT_SETUP_SURFACE.key]: {
    titleKey: PRODUCT_SETUP_SURFACE.navLabelKey,
    render: step => <ProductSetupWizard step={step} />,
  },
});

/**
 * The workspace's tab registry.
 *
 * Which screens a host offers as tabs stays the host's decision — a second host
 * mounting the same shells may want a different set — but *how* one is addressed
 * and what renders it no longer is.
 */
export const workspaceRegistry = new TabRegistry()
  .register(masterKind)
  .register(wizardKind);
