'use client';

import { SCREEN_TYPE_LABEL_KEYS } from '@r10c/business-ts-authz';
import { cn, useT, useTranslateKey } from '@r10c/entifix-react-controls';
import { usePathname } from 'next/navigation';
import { useMemo } from 'react';

import { LocaleLink, useLocaleHref } from '../i18n';
import { groupByScreenType } from './group-by-screen-type';
import type { NavItem, NavSection } from './nav';

export interface SidebarNavProps {
  sections: NavSection[];
  /** When collapsed, labels and headings hide; only icons remain. */
  collapsed?: boolean;
  /** Which domain groups are collapsed, keyed by heading. */
  collapsedGroups?: Record<string, boolean>;
  onToggleGroup?: (title: string) => void;
}

/** A path is active when it equals the item href or is nested beneath it. */
export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

const workspaceHref = (workspace: string) =>
  `/workspace?tab=${encodeURIComponent(workspace)}`;

/**
 * The two "open where" choices for one destination.
 *
 * Both used to be either absent or invisible. The workspace link existed but was
 * `opacity-0` until `group-hover/nav` — undiscoverable on touch, where there is
 * no hover — and was dropped entirely while collapsed, which is the mode a power
 * operator lives in. There was no open-in-a-browser-tab control at all; middle
 * click worked by accident, and only with a mouse.
 *
 * They are now always rendered and always focusable. `text-content-muted` plus a
 * hover/focus lift is what keeps a permanently visible control from competing
 * with the destination itself — the affordance is quiet, not hidden.
 */
function ItemActions({ item, label }: { item: NavItem; label: string }) {
  const t = useT('shell');
  const withLocale = useLocaleHref();

  return (
    <>
      {item.workspace !== undefined && (
        <LocaleLink
          href={workspaceHref(item.workspace)}
          aria-label={t('nav.openInWorkspace', { label })}
          title={t('nav.openInWorkspaceShort')}
          className="focus-ring shrink-0 rounded p-3xs text-content-muted transition-colors hover:bg-surface hover:text-content"
        >
          <span aria-hidden="true">⧉</span>
        </LocaleLink>
      )}
      <a
        href={withLocale(item.href)}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={t('nav.openInNewTab', { label })}
        title={t('nav.openInNewTabShort')}
        className="focus-ring shrink-0 rounded p-3xs text-content-muted transition-colors hover:bg-surface hover:text-content"
      >
        <span aria-hidden="true">↗</span>
      </a>
    </>
  );
}

function ItemLink({
  item,
  active,
  collapsed,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
}) {
  return (
    <LocaleLink
      href={item.href}
      aria-current={active ? 'page' : undefined}
      title={collapsed ? item.label : undefined}
      className={cn(
        'focus-ring flex flex-1 items-center gap-2xs rounded-md px-2xs py-3xs text-step-sm transition-colors',
        active ? 'bg-primary text-primary-content' : 'text-content hover:bg-surface',
      )}
    >
      {item.icon !== undefined && (
        <span aria-hidden="true" className="shrink-0">
          {item.icon}
        </span>
      )}
      {!collapsed && <span className="truncate">{item.label}</span>}
    </LocaleLink>
  );
}

/**
 * The back office's primary navigation: screen type › domain › destination.
 *
 * The top tier is the **type**, not the domain (ADR 0033). Four fixed entries
 * against the eleven domains ADR 0022 fixes for v1, so a new operator has one
 * place to look; the daily operator's speed is the command palette's job.
 *
 * **Collapsed mode deliberately does not nest.** The icon column stays flat and
 * every group becomes a labelled separator, because a flyout submenu would cost
 * an extra click per navigation to precisely the operator who chose the compact
 * mode. What collapsing hides is labels, and the per-item tooltip already
 * returns those. Group collapse is therefore an expanded-mode affordance.
 */
export function SidebarNav({
  sections,
  collapsed = false,
  collapsedGroups = {},
  onToggleGroup,
}: SidebarNavProps) {
  const t = useT('shell');
  // The four type names are `shell:` copy owned by `business-ts-authz`'s
  // `SCREEN_TYPE_LABEL_KEYS`, so they arrive as fully-qualified keys rather than
  // as names in this namespace — the documented escape hatch, not authored copy.
  const translateKey = useTranslateKey();
  const pathname = usePathname() ?? '';
  const tiers = useMemo(() => groupByScreenType(sections), [sections]);

  return (
    <nav aria-label={t('nav.primary')} className="flex flex-col gap-m">
      {tiers.map((tier, tierIndex) => (
        <div
          key={tier.type ?? `tier-${tierIndex}`}
          className="flex flex-col gap-2xs"
        >
          {tier.type !== undefined && !collapsed && (
            <p className="px-2xs text-step-xs font-semibold tracking-wide text-content uppercase">
              {translateKey(SCREEN_TYPE_LABEL_KEYS[tier.type])}
            </p>
          )}
          {/* Collapsed, the heading is gone but the grouping is not: a rule plus
              an accessible name is what keeps the icon column from reading as
              one undifferentiated list. */}
          {collapsed && tierIndex > 0 && (
            <hr className="border-border" aria-hidden="true" />
          )}
          {/* `role="group"` only where there is a name for it. An unnamed group
              is announced as an empty landmark, which is noise rather than
              structure — and the untyped section is not a screen group at all. */}
          <div
            className="flex flex-col gap-2xs"
            {...(tier.type === undefined
              ? {}
              : {
                  role: 'group',
                  'aria-label': translateKey(
                    SCREEN_TYPE_LABEL_KEYS[tier.type],
                  ),
                })}
          >
            {tier.sections.map((section, sectionIndex) => {
              const title = section.title;
              const groupCollapsed =
                title !== undefined && collapsedGroups[title] === true;
              // A collapsed group holding the active route still shows where you
              // are — otherwise collapsing a group hides the answer.
              const hasActive = section.items.some(item =>
                isActive(pathname, item.href),
              );

              return (
                <div
                  key={title ?? `section-${sectionIndex}`}
                  className="flex flex-col gap-3xs"
                >
                  {title !== undefined &&
                    !collapsed &&
                    (onToggleGroup === undefined ? (
                      <p className="px-2xs text-step-xs tracking-wide text-content-muted uppercase">
                        {title}
                      </p>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onToggleGroup(title)}
                        aria-expanded={!groupCollapsed}
                        aria-label={
                          groupCollapsed
                            ? t('sidebar.expandGroup', { group: title })
                            : t('sidebar.collapseGroup', { group: title })
                        }
                        className={cn(
                          'focus-ring flex items-center gap-3xs rounded px-2xs text-step-xs tracking-wide uppercase transition-colors hover:text-content',
                          groupCollapsed && hasActive
                            ? 'text-content'
                            : 'text-content-muted',
                        )}
                      >
                        <span aria-hidden="true">
                          {groupCollapsed ? '▸' : '▾'}
                        </span>
                        <span className="truncate">{title}</span>
                      </button>
                    ))}
                  {!(groupCollapsed && !collapsed) &&
                    section.items.map(item => (
                      <div
                        key={item.href}
                        className="flex items-center gap-3xs"
                      >
                        <ItemLink
                          item={item}
                          active={isActive(pathname, item.href)}
                          collapsed={collapsed}
                        />
                        {!collapsed && (
                          <ItemActions item={item} label={item.label} />
                        )}
                      </div>
                    ))}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
