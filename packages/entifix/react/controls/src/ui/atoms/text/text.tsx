import type { ComponentPropsWithoutRef, ElementType } from 'react';
import { cn } from '../../utils/cn';

/** Fluid type step (Utopia). Negatives taper below body for fine print. */
type Step = -2 | -1 | 0 | 1 | 2 | 3;

const STEP_CLASS: Record<Step, string> = {
  '-2': 'text-step-xs',
  '-1': 'text-step-sm',
  0: 'text-step-0',
  1: 'text-step-1',
  2: 'text-step-2',
  3: 'text-step-3',
};

type Weight = 'normal' | 'medium' | 'semibold' | 'bold';

const WEIGHT_CLASS: Record<Weight, string> = {
  normal: 'font-normal',
  medium: 'font-medium',
  semibold: 'font-semibold',
  bold: 'font-bold',
};

/** Semantic content color. Superset of the legacy `muted` flag. */
type Tone = 'default' | 'muted' | 'primary' | 'accent';

const TONE_CLASS: Record<Tone, string> = {
  default: 'text-content',
  muted: 'text-content-muted',
  primary: 'text-primary',
  accent: 'text-accent',
};

type Align = 'start' | 'center' | 'end';

const ALIGN_CLASS: Record<Align, string> = {
  start: 'text-left',
  center: 'text-center',
  end: 'text-right',
};

/** Multi-line clamp (static classes so Tailwind can see them). */
type Clamp = 1 | 2 | 3 | 4;

const CLAMP_CLASS: Record<Clamp, string> = {
  1: 'line-clamp-1',
  2: 'line-clamp-2',
  3: 'line-clamp-3',
  4: 'line-clamp-4',
};

export interface TextProps extends ComponentPropsWithoutRef<'p'> {
  /** Fluid type step (Utopia). Defaults to body (0). */
  step?: Step;
  /** Font weight. */
  weight?: Weight;
  /** Semantic color. */
  tone?: Tone;
  /** Text alignment. */
  align?: Align;
  /** Truncate to a single line with an ellipsis. */
  truncate?: boolean;
  /** Clamp to N lines with an ellipsis. */
  lineClamp?: Clamp;
  /** Shortcut for `tone="muted"`. */
  muted?: boolean;
  as?: ElementType;
}

/** Body text with fluid sizing and theme-driven color. */
export function Text({
  step = 0,
  weight,
  tone = 'default',
  align,
  truncate = false,
  lineClamp,
  muted = false,
  as: Tag = 'p',
  className,
  ...props
}: TextProps) {
  return (
    <Tag
      className={cn(
        STEP_CLASS[step],
        weight && WEIGHT_CLASS[weight],
        TONE_CLASS[muted ? 'muted' : tone],
        align && ALIGN_CLASS[align],
        truncate && 'truncate',
        lineClamp && CLAMP_CLASS[lineClamp],
        className,
      )}
      {...props}
    />
  );
}

/** Larger intro paragraph — sets a subject up before the body copy. */
export function Lead({ className, ...props }: Omit<TextProps, 'step'>) {
  return (
    <Text
      step={1}
      tone="muted"
      className={cn('max-w-prose leading-relaxed', className)}
      {...props}
    />
  );
}

/** Small supporting copy (helper text, meta). */
export function Small({ className, ...props }: Omit<TextProps, 'step' | 'as'>) {
  return <Text as="small" step={-1} className={className} {...props} />;
}

/** Caption / fine print — smallest step, muted by default. */
export function Caption({
  className,
  ...props
}: Omit<TextProps, 'step' | 'as'>) {
  return (
    <Text as="span" step={-2} tone="muted" className={className} {...props} />
  );
}

/** Overline / eyebrow — uppercase tracked label above a heading. */
export function Overline({
  className,
  ...props
}: Omit<TextProps, 'step' | 'as' | 'weight'>) {
  return (
    <Text
      as="span"
      step={-2}
      weight="semibold"
      tone="muted"
      className={cn('tracking-wide uppercase', className)}
      {...props}
    />
  );
}

/* ---------- Inline emphasis ---------- */

/** Bold inline emphasis. */
export function Strong({
  className,
  ...props
}: ComponentPropsWithoutRef<'strong'>) {
  return (
    <strong
      className={cn('font-semibold text-content', className)}
      {...props}
    />
  );
}

/** Italic inline emphasis. */
export function Em({ className, ...props }: ComponentPropsWithoutRef<'em'>) {
  return <em className={cn('italic', className)} {...props} />;
}

/** Inline code. */
export function Code({
  className,
  ...props
}: ComponentPropsWithoutRef<'code'>) {
  return (
    <code
      className={cn(
        'rounded-sm border border-border bg-surface px-2xs py-3xs',
        'font-mono text-step-sm text-content',
        className,
      )}
      {...props}
    />
  );
}

/** Keyboard key. */
export function Kbd({ className, ...props }: ComponentPropsWithoutRef<'kbd'>) {
  return (
    <kbd
      className={cn(
        'inline-flex items-center rounded-md border border-border bg-surface-elevated',
        'px-2xs py-3xs font-mono text-step-xs text-content-muted shadow-xs',
        className,
      )}
      {...props}
    />
  );
}

/** Themed anchor. */
export function Link({ className, ...props }: ComponentPropsWithoutRef<'a'>) {
  return (
    <a
      className={cn(
        'font-medium text-primary underline underline-offset-2',
        'transition-colors duration-200 ease-smooth hover:text-accent',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        className,
      )}
      {...props}
    />
  );
}

/* ---------- Block-level ---------- */

/** Pull quote — left border + muted italic body. */
export function Blockquote({
  className,
  ...props
}: ComponentPropsWithoutRef<'blockquote'>) {
  return (
    <blockquote
      className={cn(
        'border-l-4 border-primary pl-s italic',
        'text-step-1 text-content-muted',
        className,
      )}
      {...props}
    />
  );
}

export interface ListProps extends ComponentPropsWithoutRef<'ul'> {
  /** Render an ordered list (`<ol>`) with numeric markers. */
  ordered?: boolean;
}

/** Bulleted or numbered list with themed markers and fluid spacing. */
export function List({ ordered = false, className, ...props }: ListProps) {
  const Tag = ordered ? 'ol' : 'ul';
  return (
    <Tag
      className={cn(
        ordered ? 'list-decimal' : 'list-disc',
        'ms-m flex flex-col gap-2xs text-step-0 text-content marker:text-content-muted',
        className,
      )}
      {...(props as ComponentPropsWithoutRef<'ol'>)}
    />
  );
}

/** List item — pairs with `List`. */
export function ListItem({
  className,
  ...props
}: ComponentPropsWithoutRef<'li'>) {
  return <li className={cn('ps-2xs', className)} {...props} />;
}

/* ---------- Headings ---------- */

export interface HeadingProps extends ComponentPropsWithoutRef<'h2'> {
  step?: Step;
  weight?: Weight;
  as?: ElementType;
}

/** Heading primitive — fluid step + weight, defaults to the largest step. */
export function Heading({
  step = 3,
  weight = 'semibold',
  as: Tag = 'h2',
  className,
  ...props
}: HeadingProps) {
  return (
    <Tag
      className={cn(
        STEP_CLASS[step],
        WEIGHT_CLASS[weight],
        'text-content',
        className,
      )}
      {...props}
    />
  );
}

/**
 * Semantic heading components (h1–h6) mapped to the fluid type scale.
 * Sizes taper past the four Utopia steps by dropping weight for h5/h6.
 */
export type NamedHeadingProps = Omit<HeadingProps, 'as' | 'step'>;

export function HeadingOne(props: NamedHeadingProps) {
  return <Heading as="h1" step={3} weight="bold" {...props} />;
}

export function HeadingTwo(props: NamedHeadingProps) {
  return <Heading as="h2" step={2} weight="semibold" {...props} />;
}

export function HeadingThree(props: NamedHeadingProps) {
  return <Heading as="h3" step={1} weight="semibold" {...props} />;
}

export function HeadingFour(props: NamedHeadingProps) {
  return <Heading as="h4" step={0} weight="semibold" {...props} />;
}

export function HeadingFive(props: NamedHeadingProps) {
  return <Heading as="h5" step={0} weight="medium" {...props} />;
}

export function HeadingSix({ className, ...props }: NamedHeadingProps) {
  return (
    <Heading
      as="h6"
      step={0}
      weight="medium"
      className={cn('tracking-wide text-content-muted uppercase', className)}
      {...props}
    />
  );
}
