import { cva, type VariantProps } from 'class-variance-authority';

/**
 * The button's visual recipe, kept in its own module so it can be shared with
 * components that must **not** be client ones.
 *
 * `Button` is `'use client'` for a single reason — it renders HeadlessUI's
 * `Button` — and a server page that puts one inside every card in a grid pays a
 * client boundary per card. `cva` and the token classes have no such
 * constraint, so a link-shaped variant (`ButtonLink`) can wear the same clothes
 * and still render entirely on the server.
 */
export const button = cva(
  [
    'inline-flex items-center justify-center rounded-lg font-medium',
    'transition duration-200 ease-smooth active:scale-[0.97]',
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
    'disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none disabled:active:scale-100',
  ],
  {
    variants: {
      variant: {
        primary:
          'bg-primary text-primary-content shadow-sm hover:opacity-90 hover:shadow-card',
        secondary:
          'border border-border bg-surface-elevated text-content shadow-xs hover:border-primary hover:shadow-sm',
        ghost: 'bg-transparent text-content hover:bg-surface-elevated',
        // For an act that destroys something — ending every session a user
        // holds, deleting a record. The `--color-danger*` tokens already
        // existed and were being reached for as raw classes at call sites; this
        // only gives them a name, so a destructive action looks the same
        // wherever it appears rather than depending on who wrote the screen.
        destructive:
          'bg-danger text-danger-content shadow-sm hover:opacity-90 hover:shadow-card',
      },
      // Padding uses the fluid spacing tokens so buttons scale with the viewport.
      size: {
        sm: 'px-xs py-3xs text-step-0',
        md: 'px-s py-2xs text-step-0',
        lg: 'px-m py-xs text-step-1',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
);

export type ButtonVariant = NonNullable<VariantProps<typeof button>['variant']>;
export type ButtonSize = NonNullable<VariantProps<typeof button>['size']>;
export type ButtonVariantProps = VariantProps<typeof button>;
