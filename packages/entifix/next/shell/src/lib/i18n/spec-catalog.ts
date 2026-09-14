import { registerFallbackCatalog } from '@r10c/entifix-react-controls';

/**
 * An `entity` catalog for this package's own specs.
 *
 * ⚠️ **A fixture, not a shipped catalog.** `entity` names the *host's* entities,
 * so a framework shipping one would be shipping product copy — which is what
 * [ADR 0059](../../../../../../docs/adr/0059-entifix-leaves-the-repo.md)
 * removes. These specs assert that a nav entry, a palette command and a
 * workspace tab name a record in the catalog's own words; a fixture proves that
 * as well as r10c's copy did, and keeps the assertions readable as sentences.
 */
const es = {
  product: { label: 'Producto', plural: 'Productos' },
  thing: { label: 'Cosa', plural: 'Cosas' },
  widget: { label: 'Artilugio', plural: 'Artilugios' },
  'product-category': { label: 'Categoría', plural: 'Categorías' },
  'product-brand': {
    label: 'Marca',
    plural: 'Marcas',
    form: { newTitle: 'Nueva marca', editTitle: 'Editar marca' },
    fields: {
      id: 'Id',
      code: 'Código',
      name: 'Nombre',
      website: 'Sitio web',
    },
    // No `archive` on purpose — a CRUD spec asserts that a verb the
    // catalog does not name still renders, as its key.
    useCases: { retire: 'Retirar' },
  },
  'product-specification': {
    label: 'Producto',
    plural: 'Productos',
    fields: { id: 'Id', name: 'Nombre', brand: 'Marca' },
  },
  'user-identity': {
    label: 'Usuario',
    plural: 'Usuarios',
    useCases: {
      signOutOthers: 'Cerrar mis otras sesiones',
      signOutOthersConfirm:
        'Se cerrarán todas tus sesiones en otros dispositivos y navegadores. ' +
        'Ésta seguirá abierta.',
      signOutOthersKeywords: 'cerrar sesión, dispositivos, logout',
    },
  },
} as const;

registerFallbackCatalog('entity', { es, en: es });

/**
 * The same for `errors` — the code vocabulary a host's services answer with.
 * The palette renders a scope refusal through it, so it needs the two codes
 * these specs actually raise.
 */
const errors = {
  noActiveOrganization: 'Selecciona una organización para ver estos registros.',
  alreadyRetired: 'El registro ya estaba retirado.',
  unexpected: 'Ocurrió un error inesperado.',
} as const;

registerFallbackCatalog('errors', { es: errors, en: errors });
