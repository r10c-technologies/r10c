/**
 * A selectable theme. `id` is written to `data-theme` on <html> and matched
 * against the CSS palette blocks; `label` is what the switcher renders.
 */
export interface ThemeOption {
  id: string;
  label: string;
}

/** The semantic color tokens an app may supply values for. Matches the
 *  `--color-*` contract declared in @r10c/entifix-style/tokens.css. */
export type ThemeColorToken =
  | 'surface'
  | 'surface-elevated'
  | 'content'
  | 'content-muted'
  | 'primary'
  | 'primary-content'
  | 'border'
  | 'accent';

/** A runtime palette: token → CSS color. Injected as `[data-theme]` vars for
 *  brands not known at build time (multi-tenant / white-label). */
export type ThemePalette = Partial<Record<ThemeColorToken, string>>;

export interface ThemeContextValue {
  /** Active theme id (written to `data-theme`). */
  theme: string;
  setTheme: (id: string) => void;
  /** The registry this provider was configured with. */
  themes: ThemeOption[];
}
