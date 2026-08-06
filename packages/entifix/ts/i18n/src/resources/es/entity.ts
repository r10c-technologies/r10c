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
  configuration: {
    form: {
      editTitle: 'Editar parámetro',
      newTitle: 'Nuevo parámetro',
    },
    label: 'Parámetro',
    plural: 'Configuración',
    fields: {
      id: 'ID',
      service: 'Servicio',
      groupName: 'Grupo',
      key: 'Clave',
      value: 'Valor',
      isSecret: 'Secreto',
      updatedAt: 'Modificado el',
      updatedBy: 'Modificado por',
    },
  },
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
    form: {
      editTitle: 'Editar marca',
      newTitle: 'Nueva marca',
    },
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
    form: {
      editTitle: 'Editar categoría',
      newTitle: 'Nueva categoría',
    },
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
  'user-device': {
    label: 'Dispositivo',
    plural: 'Dispositivos',
    fields: {
      id: 'ID',
      userId: 'ID de usuario',
      deviceId: 'ID de dispositivo',
      browser: 'Navegador',
      os: 'Sistema operativo',
      type: 'Tipo',
      lastIp: 'Última IP',
      firstSeenAt: 'Primera vez',
      lastSeenAt: 'Última vez',
    },
  },
  organization: {
    label: 'Organización',
    plural: 'Organizaciones',
    fields: {
      id: 'ID',
      name: 'Nombre',
      slug: 'Identificador',
      status: 'Estado',
    },
    values: {
      status: {
        active: 'Activa',
        suspended: 'Suspendida',
        archived: 'Archivada',
      },
    },
  },
  individual: {
    label: 'Persona',
    plural: 'Personas',
    fields: {
      id: 'ID',
      fullName: 'Nombre completo',
      userId: 'ID de usuario',
      partyRole: 'Rol que desempeña',
    },
    values: {
      partyRole: {
        customer: 'Cliente',
        vendor: 'Vendedor',
        operator: 'Operador',
      },
    },
  },
  membership: {
    label: 'Membresía',
    plural: 'Membresías',
    fields: {
      id: 'ID',
      partyId: 'ID de parte',
      organizationId: 'ID de organización',
      roleIds: 'Roles',
      isDefault: 'Predeterminada',
    },
  },
  role: {
    label: 'Rol',
    plural: 'Roles',
    fields: {
      id: 'ID',
      organizationId: 'ID de organización',
      name: 'Nombre',
      permissions: 'Permisos',
    },
  },
  entitlement: {
    label: 'Habilitación',
    plural: 'Habilitaciones',
    fields: {
      id: 'ID',
      organizationId: 'ID de organización',
      domains: 'Módulos',
    },
  },
};
