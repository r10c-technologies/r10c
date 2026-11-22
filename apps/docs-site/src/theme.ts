/**
 * The palettes a reader may pick, and the ones fumadocs treats as dark: the
 * framework's own presets, since the site has no brand of its own. Apart from
 * `site.ts` so the client providers never import the registers.
 */
export const THEME_IDS = ['aurora', 'midnight'] as const;
export const DARK_PALETTES = ['midnight'];
