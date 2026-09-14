import { defineCatalogs } from '@entifix/i18n';

import { controlsCatalogs } from '../catalog';

/**
 * Catalogs for this package's own specs.
 *
 * ⚠️ **`entity` and `errors` are fixtures here, not shipped catalogs.** Both are
 * *host* namespaces now: `entity` names the adopter's entities and `errors` is
 * the code vocabulary their services answer with, so a framework shipping either
 * would be shipping product copy — which is exactly what
 * [ADR 0059](../../../../../../docs/adr/0059-entifix-leaves-the-repo.md)
 * removes. What these specs prove is that a `labelKey` resolves against whatever
 * catalog is installed, and a fixture proves that as well as r10c's did.
 *
 * The keys below are the ones the specs actually name, kept verbatim so the
 * assertions still read as sentences rather than as placeholders.
 */
const entity = {
  es: {
    'product-specification': {
      label: 'Producto',
      plural: 'Productos',
      fields: { code: 'Código', name: 'Nombre' },
    },
    'user-identity': {
      values: { role: { admin: 'Administrador', user: 'Usuario' } },
      useCases: {
        revokeSessions: 'Cerrar sesiones',
        revokeSessionsConfirm: '¿Cerrar todas las sesiones?',
      },
    },
    'product-brand': {
      useCases: { retire: 'Retirar', retireConfirm: '¿Retirar la marca?' },
    },
    gadget: {
      useCases: {
        compare: 'Comparar',
        import: 'Importar',
        purge: 'Purgar',
        purgeConfirm: '¿Purgar el registro?',
        revokeSessions: 'Cerrar sesiones',
        revokeSessionsConfirm: '¿Cerrar todas las sesiones?',
        settleAll: 'Liquidar todo',
        updateAspects: 'Actualizar aspectos',
      },
    },
    'context-dependent': 'Depende del contexto',
    'context-independent': 'Independiente del contexto',
    determining: 'Determinante',
  },
  en: {
    'product-specification': {
      label: 'Product',
      plural: 'Products',
      fields: { code: 'Code', name: 'Name' },
    },
    'user-identity': {
      values: { role: { admin: 'Administrator', user: 'User' } },
      useCases: {
        revokeSessions: 'Revoke sessions',
        revokeSessionsConfirm: 'Revoke every session?',
      },
    },
    'product-brand': {
      useCases: { retire: 'Retire', retireConfirm: 'Retire the brand?' },
    },
    gadget: {
      useCases: {
        compare: 'Compare',
        import: 'Import',
        purge: 'Purge',
        purgeConfirm: 'Purge the record?',
        revokeSessions: 'Revoke sessions',
        revokeSessionsConfirm: 'Revoke every session?',
        settleAll: 'Settle all',
        updateAspects: 'Update aspects',
      },
    },
    'context-dependent': 'Context dependent',
    'context-independent': 'Context independent',
    determining: 'Determining',
  },
} as const;

const errors = {
  es: {
    unauthenticated: 'No autenticado',
    forbidden: 'Sin permiso',
    notFound: 'No encontrado',
    invalidQuery: 'La consulta no es válida.',
    unexpected: 'Error inesperado',
  },
  en: {
    unauthenticated: 'Not authenticated',
    forbidden: 'Forbidden',
    notFound: 'Not found',
    invalidQuery: 'The query is not valid.',
    unexpected: 'Unexpected error',
  },
} as const;

export function installSpecCatalogs(): void {
  defineCatalogs({
    resources: {
      es: { ...controlsCatalogs.es, entity: entity.es, errors: errors.es },
      en: { ...controlsCatalogs.en, entity: entity.en, errors: errors.en },
    },
    namespaces: ['controls', 'entity', 'errors'],
    defaultNS: 'controls',
  });
}
