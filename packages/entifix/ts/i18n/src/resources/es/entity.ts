/**
 * Entity metadata copy. Keyed by the entity's own `@entity({ key })`, so a
 * `labelKey` is derivable rather than invented: `entity:product.fields.code`,
 * `entity:user-identity.values.role.admin`.
 *
 * These never cross the wire — `serializeEntity` emits values only, and
 * `describeEntityColumns` runs client-side against the shared entity class — so
 * translation happens in the browser with no metadata endpoint involved.
 */
export const entity = {
  product: {
    form: {
      brandEmbedded: 'Marca (incrustada)',
      categoryForeign: 'Categoría (clave foránea)',
      // Whole titles rather than a verb interpolated with `label`: Spanish
      // inflects the adjective for the noun's gender ("Nuevo producto" but
      // "Nueva marca"), so a shared template would be wrong for half of them.
      editTitle: 'Editar producto',
      newTitle: 'Nuevo producto',
    },
    label: 'Producto',
    plural: 'Productos',
    fields: {
      id: 'ID',
      code: 'Código',
      name: 'Nombre',
      description: 'Descripción',
      brand: 'Marca',
      category: 'Categoría',
    },
  },
  'product-brand': {
    label: 'Marca',
    plural: 'Marcas',
    fields: {
      id: 'ID',
      code: 'Código',
      name: 'Nombre',
      description: 'Descripción',
      website: 'Sitio web',
    },
  },
  'product-category': {
    label: 'Categoría',
    plural: 'Categorías',
    fields: {
      id: 'ID',
      code: 'Código',
      name: 'Nombre',
      description: 'Descripción',
    },
  },
  'user-identity': {
    label: 'Usuario',
    plural: 'Usuarios',
    fields: {
      id: 'ID',
      displayName: 'Nombre visible',
      status: 'Estado',
      role: 'Rol',
      identifiers: 'Identificadores',
    },
    values: {
      role: {
        user: 'Usuario',
        admin: 'Administrador',
        'super-admin': 'Superadministrador',
      },
      status: {
        active: 'Activo',
        suspended: 'Suspendido',
        disabled: 'Deshabilitado',
      },
    },
  },
  'entity-identifier': {
    label: 'Identificador',
    plural: 'Identificadores',
    fields: {
      id: 'ID',
      userId: 'ID de usuario',
      type: 'Tipo',
      value: 'Valor',
      provider: 'Proveedor',
      verified: 'Verificado',
    },
    values: {
      type: {
        email: 'Correo',
        username: 'Usuario',
        phone: 'Teléfono',
        oauth: 'OAuth',
        'external-subject': 'Sujeto externo',
      },
    },
  },
};
