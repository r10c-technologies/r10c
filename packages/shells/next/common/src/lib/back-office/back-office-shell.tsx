'use client';

import { Button, Sidebar, useUiPreference } from '@r10c/entifix-react-controls';
import type { ReactNode } from 'react';

import { BackOfficeBreadcrumbs } from './breadcrumbs';
import type { NavSection } from './nav';
import { SidebarNav } from './sidebar-nav';

/** `namespace:` is prepended by the store → `r10c-ui:back-office:sidebar`. */
const SIDEBAR_PREF_KEY = 'back-office:sidebar-collapsed';

export interface BackOfficeShellProps {
  /** Grouped primary navigation. */
  nav: NavSection[];
  /** Brand mark shown at the top of the sidebar. */
  brand: ReactNode;
  children: ReactNode;
  /** Segment → label overrides for the breadcrumb trail. */
  breadcrumbLabels?: Record<string, string>;
  /** Label for the root breadcrumb. */
  homeLabel?: string;
}

/**
 * Back-office page shell: a strong, collapsible sidebar + a top bar carrying
 * breadcrumbs, wrapping the routed content. Collapse state is persisted through
 * the design system's `UiPreferencesStore`, so it survives reloads. Composed
 * from the agnostic `Sidebar` primitive — the Next coupling (routing,
 * breadcrumbs) lives here, not in the primitive.
 */
export function BackOfficeShell({
  nav,
  brand,
  children,
  breadcrumbLabels,
  homeLabel,
}: BackOfficeShellProps) {
  const { value: collapsed, setValue: setCollapsed } = useUiPreference<boolean>(
    SIDEBAR_PREF_KEY,
    false,
  );

  return (
    <Sidebar gap="none" className="min-h-screen">
      <Sidebar.Side
        as="aside"
        width={collapsed ? '4.5rem' : '16rem'}
        className="flex flex-col gap-m border-r border-border bg-surface-elevated p-s md:sticky md:top-0 md:h-screen md:overflow-y-auto"
      >
        <div className="flex items-center justify-center px-2xs py-3xs text-step-1 font-semibold text-content">
          {collapsed ? null : brand}
        </div>
        <SidebarNav sections={nav} collapsed={collapsed} />
      </Sidebar.Side>

      <Sidebar.Main as="main" className="flex flex-col">
        <header className="flex items-center gap-s border-b border-border bg-surface-elevated px-m py-s">
          <Button
            variant="ghost"
            size="sm"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-pressed={collapsed}
            onClick={() => setCollapsed(!collapsed)}
          >
            <span aria-hidden="true">☰</span>
          </Button>
          <BackOfficeBreadcrumbs
            labels={breadcrumbLabels}
            homeLabel={homeLabel}
          />
        </header>
        <div className="flex-1 p-m">{children}</div>
      </Sidebar.Main>
    </Sidebar>
  );
}
