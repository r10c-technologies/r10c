import { app as enApp } from './en/app';
import { controls as enControls } from './en/controls';
import { entity as enEntity } from './en/entity';
import { errors as enErrors } from './en/errors';
import { shell as enShell } from './en/shell';
import { app as esApp } from './es/app';
import { controls as esControls } from './es/controls';
import { entity as esEntity } from './es/entity';
import { errors as esErrors } from './es/errors';
import { shell as esShell } from './es/shell';

/**
 * One namespace per owner: `controls` for the agnostic entity UI, `shell` for
 * the Next back-office chrome, `errors` for the code vocabulary services answer
 * with, `entity` for metadata labels, `app` for per-app copy.
 */
export const NAMESPACES = [
  'controls',
  'shell',
  'errors',
  'entity',
  'app',
] as const;

export type Namespace = (typeof NAMESPACES)[number];

export const defaultNS: Namespace = 'controls';

export const resources = {
  es: {
    controls: esControls,
    shell: esShell,
    errors: esErrors,
    entity: esEntity,
    app: esApp,
  },
  en: {
    controls: enControls,
    shell: enShell,
    errors: enErrors,
    entity: enEntity,
    app: enApp,
  },
};

export type Resources = (typeof resources)['es'];

/**
 * The typed-key gate. Binding `CustomTypeOptions` to the Spanish shape makes
 * `t('controls:table.acions')` a compile error in every consumer of this package
 * — which is what turns "translate your strings" from a convention into
 * something a build can enforce.
 *
 * It lives in this barrel rather than a standalone `.d.ts` so it is always part
 * of the emitted declaration graph, and so it can never be tree-shaken away from
 * a consumer that only imports `resources`.
 */
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'controls';
    resources: Resources;
  }
}
