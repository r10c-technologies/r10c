import { controls as enControls } from './en';
import { controls as esControls } from './es';

/**
 * The one namespace `@entifix/react-controls` owns — copy for the agnostic
 * entity UI: a table's empty state, a filter builder's operators, a form's
 * validation messages.
 *
 * It ships with the components that render it, so taking the controls means
 * taking their strings and nothing else. It used to live in the i18n package
 * beside a back office's chrome and a marketplace's product copy.
 */
export const controlsCatalogs = {
  es: { controls: esControls },
  en: { controls: enControls },
} as const;

/** The namespace above, for a host composing `CustomTypeOptions`. */
export type ControlsResources = (typeof controlsCatalogs)['es'];

export const CONTROLS_NAMESPACES = ['controls'] as const;
