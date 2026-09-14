'use client';

import {
  Button,
  Drawer,
  Sidebar,
  useT,
  useUiPreference,
  useViewportMode,
} from '@r10c/entifix-react-controls';
import { usePathname } from 'next/navigation';
import { type ReactNode, useState } from 'react';

import { BackOfficeBreadcrumbs } from './breadcrumbs';
import type { NavSection } from './nav';
import { SidebarNav } from './sidebar-nav';

/** `namespace:` is prepended by the store → `r10c-ui:back-office:sidebar-collapsed`. */
const SIDEBAR_PREF_KEY = 'back-office:sidebar-collapsed';

/**
 * Which domain groups are collapsed, as one keyed record rather than a key per
 * group. `useUiPreference` resolves asynchronously after mount, so N keys would
 * be N first-paint transitions; one read settles the whole sidebar at once.
 */
const NAV_GROUPS_PREF_KEY = 'back-office:nav-collapsed-groups';

export interface BackOfficeShellProps {
  /** Grouped primary navigation. */
  nav: NavSection[];
  /** Brand mark shown at the top of the sidebar. */
  brand: ReactNode;
  children: ReactNode;
  /** Segment → label overrides for the breadcrumb trail. */
  breadcrumbLabels?: Record<string, string>;
  /**
   * Right-aligned slot in the top bar — the account menu. A slot rather than a
   * built-in, because what belongs in it differs per host: the label is the
   * signed-in subject where a layout has resolved a principal, and a bare
   * caption where it has not.
   */
  accountMenu?: ReactNode;
  /**
   * The command palette, trigger and all.
   *
   * A slot for a reason the account menu does not share: the palette's use-case
   * sources carry entity constructors and handler functions, neither of which
   * survives the server→client boundary, so it cannot be built from serializable
   * props here. The host composes it in a client module of its own and hands it
   * over — which also keeps this `shell:base` package from naming any domain's
   * entities.
   */
  commandPalette?: ReactNode;
}

/**
 * Back-office page shell: a collapsible sidebar + a top bar carrying
 * breadcrumbs, wrapping the routed content. Composed from the agnostic
 * `Sidebar` primitive — the Next coupling (routing, breadcrumbs) lives here,
 * not in the primitive.
 *
 * **Collapse has two inputs, and only one of them is a preference.** The stored
 * choice is the person's; a `rail`-width viewport forces the compact form
 * whatever they chose. They are kept apart deliberately: writing the forced
 * value back would mean a single visit at a narrow width silently rewrites the
 * choice, and the sidebar comes back collapsed on the desktop the person set it
 * expanded on.
 *
 * Below `rail` the sidebar is not a sidebar at all — it is a drawer, built on
 * Headless UI's `Dialog` for the focus trap, `Escape` handling, backdrop click
 * and focus restoration that a hand-rolled one has to get right and usually does
 * not. There is exactly one `SidebarNav` in the tree either way; rendering a
 * second copy for the drawer is how the two drift.
 */
export function BackOfficeShell({
  nav,
  brand,
  children,
  breadcrumbLabels,
  accountMenu,
  commandPalette,
}: BackOfficeShellProps) {
  const t = useT('shell');
  const mode = useViewportMode();
  const pathname = usePathname();
  const { value: preferCollapsed, setValue: setCollapsed } =
    useUiPreference<boolean>(SIDEBAR_PREF_KEY, false);
  const { value: collapsedGroups, setValue: setCollapsedGroups } =
    useUiPreference<Record<string, boolean>>(NAV_GROUPS_PREF_KEY, {});
  // The drawer remembers *where* it was opened, and is open only while the
  // visitor is still there. A drawer that survives navigation covers the page
  // they just asked for, and closing it from an effect keyed on the route would
  // set state during a passive effect — a cascading render for something that is
  // derivable, since "still on the page I opened this from" is a fact about the
  // current render rather than an event to react to.
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const isDrawerOpen = openedAt !== null && openedAt === pathname;
  const setDrawerOpen = (open: boolean) => setOpenedAt(open ? pathname : null);

  // Three modes, one answer. A drawer has the whole viewport's width, so it
  // shows labels whatever the stored preference says — that preference is about
  // how much room the sidebar should take beside the content, and in a drawer
  // there is no beside.
  const collapsed =
    mode === 'rail' ? true : mode === 'compact' ? false : preferCollapsed;
  const toggleGroup = (title: string) =>
    setCollapsedGroups({
      ...collapsedGroups,
      [title]: collapsedGroups[title] !== true,
    });

  const navTree = (
    <SidebarNav
      sections={nav}
      collapsed={collapsed}
      collapsedGroups={collapsedGroups}
      onToggleGroup={toggleGroup}
    />
  );

  const isCompact = mode === 'compact';

  return (
    <Sidebar gap="none" className="min-h-screen">
      {isCompact ? null : (
        <Sidebar.Side
          as="aside"
          width={collapsed ? '4.5rem' : '16rem'}
          className="flex flex-col gap-m border-r border-border bg-surface-elevated p-s md:sticky md:top-0 md:h-screen md:overflow-y-auto"
        >
          <div className="flex items-center justify-center px-2xs py-3xs text-step-1 font-semibold text-content">
            {collapsed ? null : brand}
          </div>
          {navTree}
        </Sidebar.Side>
      )}

      <Sidebar.Main as="main" className="flex flex-col">
        <header className="flex items-center gap-s border-b border-border bg-surface-elevated px-m py-s">
          <Button
            variant="ghost"
            size="sm"
            aria-label={
              isCompact
                ? t('sidebar.openMenu')
                : collapsed
                  ? t('sidebar.expand')
                  : t('sidebar.collapse')
            }
            // A drawer trigger is not a two-state toggle — it opens a thing that
            // closes itself — so it reports pressed state only where it is one.
            {...(isCompact ? {} : { 'aria-pressed': collapsed })}
            onClick={() =>
              isCompact ? setDrawerOpen(true) : setCollapsed(!preferCollapsed)
            }
          >
            <span aria-hidden="true">☰</span>
          </Button>
          <BackOfficeBreadcrumbs labels={breadcrumbLabels} />
          <div className="ml-auto flex items-center gap-2xs">
            {commandPalette}
            {accountMenu}
          </div>
        </header>
        <div className="flex-1 p-m">{children}</div>
      </Sidebar.Main>

      {isCompact && (
        <Drawer
          open={isDrawerOpen}
          onClose={() => setDrawerOpen(false)}
          title={brand}
          closeLabel={t('sidebar.closeMenu')}
        >
          {navTree}
        </Drawer>
      )}
    </Sidebar>
  );
}
