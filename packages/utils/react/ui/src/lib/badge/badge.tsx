import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'danger';

const BADGE_TONE: Record<BadgeTone, string> = {
  neutral: 'bg-surface-elevated text-content border border-border',
  accent: 'bg-accent text-primary-content',
  success: 'bg-primary text-primary-content',
  danger: 'bg-danger text-danger-content',
};

export interface BadgeProps {
  readonly tone?: BadgeTone;
  /** Text, so the meaning never rests on the colour alone. */
  readonly children: ReactNode;
}

/** A short status over a card's media: "Nuevo", "Agotado". */
export function Badge({ tone = 'neutral', children }: BadgeProps) {
  return (
    <span
      data-tone={tone}
      className={`text-step--1 inline-flex items-center rounded-full px-2xs font-medium ${BADGE_TONE[tone]}`}
    >
      {children}
    </span>
  );
}

export interface ChipProps {
  readonly children: ReactNode;
  /** A chip that narrows a listing is a link to that listing. */
  readonly href?: string;
}

/** An attribute of a product: a material, a feature, a facet value. */
export function Chip({ children, href }: ChipProps) {
  const className =
    'inline-flex items-center rounded-full border border-border px-2xs text-step--1 text-content-muted';
  return href === undefined ? (
    <span className={className}>{children}</span>
  ) : (
    <a className={`${className} hover:text-content`} href={href}>
      {children}
    </a>
  );
}
