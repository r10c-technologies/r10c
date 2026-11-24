/**
 * The namespaces r10c's i18next setup declares, and its default. A module of
 * its own, holding no copy, so the client installer can name them without
 * bundling a single catalog.
 */
export const NAMESPACES = [
  'controls',
  'shell',
  'errors',
  'entity',
  'app',
  'r10c',
] as const;

export const DEFAULT_NS = 'controls';
