'use client';

import type { ScreenType } from '@r10c/business-ts-authz';
import { UserDetailPage, UsersPage } from '@r10c/shells-next-auth';
import {
  entityTabKind,
  type EntityTabScreens,
  TabRegistry,
  wizardTabKind,
} from '@r10c/shells-next-common';
import {
  MARKETPLACE_ADMIN_CRUDS,
  PRODUCT_SETUP_SURFACE,
  ProductSetupWizard,
} from '@r10c/shells-next-marketplace-admin';
import { STOCK_CRUDS } from '@r10c/shells-next-stock';
import { ConfigurationListClientPage } from '@r10c/shells-next-system-management';

import { EntityEditorTab } from './entity-tab';

/**
 * The generated screens of one shell, as the two halves a tab kind needs.
 *
 * This was two hand-written const maps and a third in `entity-tab.tsx`, all
 * keyed by the same entity keys — against the 28 entities ADR 0022 fixes for
 * v1. Nothing failed when one was missed: a key absent from the list map opened
 * a tab onto nothing, and one absent from the editor map made the sidebar's
 * open-in-workspace control silently do nothing at all (#133). The list, the
 * editor, the tab caption and the route all come from the `EntityCrud`
 * descriptor the pages themselves were generated from.
 *
 * `type` rides through to the editor, because a record tab's autosaved draft is
 * keyed on the same address the tab is — and an editor that hard-coded `master`
 * would detach an Operaciones record from its own draft while every test
 * passed.
 */
const screensFor = (
  type: ScreenType,
  cruds: ReadonlyArray<(typeof MARKETPLACE_ADMIN_CRUDS)[number]>,
): EntityTabScreens => ({
  lists: Object.fromEntries(
    cruds.map(crud => [
      crud.entityKey,
      {
        // The entity's own `@entity({ pluralKey })`, so a tab caption cannot
        // drift from the heading of the table inside it.
        titleKey: crud.entityPluralKey,
        render: () => <crud.ListPage />,
      },
    ]),
  ),
  records: Object.fromEntries(
    cruds.map(crud => [
      crud.entityKey,
      {
        labelKey: crud.entityLabelKey,
        render: (id: string) => (
          <EntityEditorTab
            type={type}
            entityKey={crud.entityKey}
            id={id}
            Page={crud.SingleViewPage}
          />
        ),
      },
    ]),
  ),
});

/**
 * Definiciones — the catalog, plus the two screens that are not `makeEntityCrud`
 * output.
 *
 * `Configuration` earns its exception: its screen is hand-built and it has no
 * record tab at all, because there is no single-configuration page to open. An
 * entity that *can* be derived is not a line here.
 */
const masterScreens = (): EntityTabScreens => {
  const derived = screensFor('master', MARKETPLACE_ADMIN_CRUDS);
  return {
    lists: {
      ...derived.lists,
      configuration: {
        titleKey: 'shell:systemManagement.nav.configuration',
        render: () => <ConfigurationListClientPage />,
      },
      'user-identity': {
        titleKey: 'entity:user-identity.plural',
        render: () => <UsersPage />,
      },
    },
    records: {
      ...derived.records,
      // Hand-written rather than generated — auth-service's PATCH accepts two
      // aspects and nothing else — but it takes the same props every generated
      // single view does, which is what lets it be a record tab at all.
      'user-identity': {
        labelKey: 'entity:user-identity.label',
        render: (id: string) => (
          <EntityEditorTab
            type="master"
            entityKey="user-identity"
            id={id}
            Page={UserDetailPage}
          />
        ),
      },
    },
  };
};

/**
 * Every guided screen a `wizard:` tab can open.
 *
 * The third address segment is the **step**, which is the one thing ADR 0045
 * changed about the grammar — under an entity kind it is a record. The flow
 * itself decides whether to honour it: `goTo` moves only to a step already on
 * the path, so an address naming a step nobody walked opens the wizard at its
 * beginning rather than skipping the validation in between.
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
 * mounting the same shells may want a different set — but *how* one is
 * addressed and what renders it no longer is: `master:` and `operation:` are
 * the same parser over different descriptor lists, because the list and the
 * record are the same screen with and without an id whatever produced the
 * record (ADR 0042).
 */
export const workspaceRegistry = new TabRegistry()
  .register(entityTabKind('master', masterScreens()))
  // Operaciones: stock, whose records a *process* made — a movement upserts the
  // item, the checkout crossing writes the hold (ADR 0033).
  .register(entityTabKind('operation', screensFor('operation', STOCK_CRUDS)))
  .register(wizardKind);
