import { registerFallbackCatalog } from '@r10c/entifix-react-controls';

import { shell as enShell } from './en';
import { shell as esShell } from './es';

/**
 * The one namespace `@entifix/next-shell` owns — the chrome an entity
 * application is served in: navigation, the account menu, the command palette,
 * the workspace's own words.
 */
export const shellCatalogs = {
  es: { shell: esShell },
  en: { shell: enShell },
} as const;

/** The namespace above, for a host composing `CustomTypeOptions`. */
export type ShellResources = (typeof shellCatalogs)['es'];

export const SHELL_NAMESPACES = ['shell'] as const;

/**
 * So a shell component renders its own copy with no provider mounted — a spec,
 * a Storybook story, a page that forgot. Same promise `@entifix/react-controls`
 * makes about the `controls` namespace, kept by the package that owns `shell`.
 */
registerFallbackCatalog('shell', { es: esShell, en: enShell });
