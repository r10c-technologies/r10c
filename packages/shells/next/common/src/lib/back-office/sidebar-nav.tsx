'use client';

import { cn } from '@r10c/entifix-react-controls';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import type { NavSection } from './nav';

export interface SidebarNavProps {
  sections: NavSection[];
  /** When collapsed, labels and section titles hide; only icons remain. */
  collapsed?: boolean;
}

/** A path is active when it equals the item href or is nested beneath it. */
export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SidebarNav({ sections, collapsed = false }: SidebarNavProps) {
  const pathname = usePathname() ?? '';

  return (
    <nav aria-label="Primary" className="flex flex-col gap-m">
      {sections.map((section, index) => (
        <div key={section.title ?? index} className="flex flex-col gap-3xs">
          {section.title && !collapsed && (
            <p className="px-2xs text-step-xs tracking-wide text-content-muted uppercase">
              {section.title}
            </p>
          )}
          {section.items.map(item => {
            const active = isActive(pathname, item.href);
            return (
              <div key={item.href} className="group/nav flex items-center gap-3xs">
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  title={collapsed ? item.label : undefined}
                  className={cn(
                    'flex flex-1 items-center gap-2xs rounded-md px-2xs py-3xs text-step-sm transition-colors',
                    active
                      ? 'bg-primary text-primary-content'
                      : 'text-content hover:bg-surface',
                  )}
                >
                  {item.icon && (
                    <span aria-hidden="true" className="shrink-0">
                      {item.icon}
                    </span>
                  )}
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </Link>
                {item.workspace && !collapsed && (
                  <Link
                    href={`/workspace?tab=${encodeURIComponent(item.workspace)}`}
                    aria-label={`Open ${item.label} in workspace`}
                    title="Open in workspace"
                    className="rounded p-3xs text-content-muted opacity-0 transition hover:bg-surface hover:text-content focus:opacity-100 group-hover/nav:opacity-100"
                  >
                    <span aria-hidden="true">⧉</span>
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
