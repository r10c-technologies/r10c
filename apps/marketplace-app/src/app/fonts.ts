import { Inter, JetBrains_Mono } from 'next/font/google';

/**
 * The app's faces.
 *
 * This module is duplicated per app rather than shared from a package, and that
 * is deliberate: `next/font/google` is a compiler macro — Next resolves the
 * call at build time, downloads the files and self-hosts them from this app's
 * own origin. A workspace library is consumed as prebuilt `dist` JavaScript, so
 * the call would reach the runtime unprocessed. Ten lines twice is the cost of
 * not breaking that.
 *
 * `variable` is what connects them to the design system: `--font-inter` and
 * `--font-jetbrains-mono` are the first entry in `--font-sans` / `--font-mono`
 * in `@r10c/entifix-style/tokens.css`, and everything behind them there is a
 * real fallback stack — what renders during the swap.
 *
 * `next/font` also generates a `size-adjust` fallback face, which is why the
 * prerendered storefront does not lurch when the real face arrives.
 */
export const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

export const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-jetbrains-mono',
});

/** Both variables, for the `<html>` element. */
export const fontVariables = `${inter.variable} ${jetbrainsMono.variable}`;
