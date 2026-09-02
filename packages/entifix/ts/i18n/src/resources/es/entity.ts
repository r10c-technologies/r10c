/**
 * Entity metadata copy. Keyed by the entity's own `@entity({ key })`, so a
 * `labelKey` is derivable rather than invented: `entity:product-specification.fields.code`,
 * `entity:user-identity.values.role.admin`.
 *
 * Resolved copy never crosses the wire — `serializeEntity` emits values only, and
 * `describeEntityColumns` runs client-side against the shared entity class, so
 * translation always happens in the browser. `$metadata` (ADR 0026) serves
 * **use-case** descriptors, and carries these keys rather than resolving them.
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
  'product-specification': {
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
  /**
   * El ciclo de vida del vocabulario compartido, en un solo sitio: marcas y
   * categorías comparten `enumLabelKey`, porque es el mismo estado retirado por
   * el mismo operador en la misma pantalla.
   */
  'reference-status': {
    active: 'Activo',
    retired: 'Retirado',
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
      status: 'Estado',
    },
    // "Retirar", no "Eliminar": el registro sigue existiendo y las ofertas ya
    // clasificadas con él siguen resolviendo — lo que cambia es que deja de
    // ofrecerse para clasificar nuevas.
    useCases: {
      retire: 'Retirar',
      retireConfirm:
        'Estas marcas dejarán de ofrecerse al clasificar productos. Las ofertas ya publicadas con ellas no cambian.',
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
      status: 'Estado',
    },
    useCases: {
      retire: 'Retirar',
      retireConfirm:
        'Estas categorías dejarán de ofrecerse al clasificar productos y desaparecerán del árbol de navegación. Las ofertas ya publicadas con ellas no cambian.',
    },
  },
  'user-identity': {
    label: 'Usuario',
    plural: 'Usuarios',
    // Whole phrases rather than a verb plus `label`, for the reason recorded on
    // the form titles above. The voice matches `shell.sessions.revoke`, which
    // says "Cerrar", not "Revocar".
    useCases: {
      revokeSessions: 'Cerrar todas las sesiones',
      revokeSessionsConfirm:
        'Se cerrarán todas las sesiones de este usuario en todos sus dispositivos. Recibirá un aviso por correo.',
      updateAspects: 'Cambiar rol y estado',
    },
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
    },
  },
  'party-role': {
    label: 'Rol de parte',
    plural: 'Roles de parte',
    fields: {
      id: 'ID',
      partyId: 'ID de parte',
      role: 'Rol',
    },
    values: {
      role: {
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
  'dictionary-term': {
    label: 'Término del diccionario',
    plural: 'Términos del diccionario',
    fields: {
      id: 'ID',
      code: 'Código',
      values: 'Valores',
      unit: 'Unidad',
    },
  },
  'published-offering': {
    label: 'Oferta publicada',
    plural: 'Ofertas publicadas',
    fields: {
      id: 'ID',
      offeringId: 'ID de oferta',
      vendorId: 'ID de vendedor',
      name: 'Nombre',
      amount: 'Importe',
      currency: 'Moneda',
      availableHint: 'Disponibilidad estimada',
    },
  },
  'product-order': {
    label: 'Pedido',
    plural: 'Pedidos',
    fields: {
      id: 'ID',
      buyerId: 'ID de comprador',
      status: 'Estado',
      items: 'Líneas',
      /**
       * Los miembros de una línea. `items` es una `composition`, así que la
       * rejilla de detalle saca sus columnas de la metadata de `OrderItem` y
       * necesita estas claves — anidadas bajo el maestro porque una línea no
       * es una entidad y no tiene clave propia.
       */
      item: {
        offeringId: 'ID de oferta',
        vendorId: 'ID de vendedor',
        quantity: 'Cantidad',
        amount: 'Importe',
        currency: 'Moneda',
        reservationId: 'ID de reserva',
      },
      channel: 'Canal de venta',
      placedAt: 'Fecha del pedido',
    },
    values: {
      status: {
        pending: 'Pendiente',
        paid: 'Pagado',
        fulfilled: 'Entregado',
        cancelled: 'Cancelado',
      },
    },
  },
  payment: {
    label: 'Pago',
    plural: 'Pagos',
    fields: {
      id: 'ID',
      orderId: 'ID de pedido',
      amount: 'Importe',
      currency: 'Moneda',
      status: 'Estado',
      paymentMethod: 'Forma de pago',
      channelId: 'ID de canal',
      providerReference: 'Referencia del proveedor',
    },
    values: {
      status: {
        pending: 'Pendiente',
        authorized: 'Autorizado',
        captured: 'Cobrado',
        failed: 'Fallido',
      },
      method: {
        cash: 'Efectivo',
        card: 'Tarjeta',
        voucher: 'Vale',
        transfer: 'Transferencia',
      },
    },
  },
  agreement: {
    label: 'Acuerdo',
    plural: 'Acuerdos',
    fields: {
      id: 'ID',
      vendorId: 'ID de vendedor',
      commissionBasisPoints: 'Comisión (puntos básicos)',
      channelCommissionBasisPoints: 'Comisión por canal (puntos básicos)',
      effectiveFrom: 'Vigente desde',
    },
  },
  'commission-entry': {
    label: 'Apunte de comisión',
    plural: 'Apuntes de comisión',
    fields: {
      id: 'ID',
      orderId: 'ID de pedido',
      vendorId: 'ID de vendedor',
      commissionAmount: 'Importe de comisión',
      currency: 'Moneda',
    },
  },
  'settlement-run': {
    label: 'Liquidación',
    plural: 'Liquidaciones',
    fields: {
      id: 'ID',
      periodStart: 'Inicio del periodo',
      periodEnd: 'Fin del periodo',
      status: 'Estado',
    },
    values: {
      status: {
        open: 'Abierta',
        calculated: 'Calculada',
        paid: 'Pagada',
        cancelled: 'Cancelada',
      },
    },
  },
  'vendor-payout': {
    label: 'Pago a vendedor',
    plural: 'Pagos a vendedores',
    fields: {
      id: 'ID',
      runId: 'ID de liquidación',
      vendorId: 'ID de vendedor',
      amount: 'Importe',
      currency: 'Moneda',
    },
  },
  'product-offering': {
    label: 'Oferta comercial',
    plural: 'Ofertas comerciales',
    fields: {
      id: 'ID',
      name: 'Nombre',
      specificationId: 'ID de especificación',
      status: 'Estado',
    },
    values: {
      status: {
        draft: 'Borrador',
        'pending-review': 'Pendiente de revisión',
        published: 'Publicada',
        unpublished: 'Retirada',
      },
    },
  },
  'product-offering-price': {
    label: 'Precio de oferta',
    plural: 'Precios de oferta',
    fields: {
      id: 'ID',
      offeringId: 'ID de oferta',
      amount: 'Importe',
      currency: 'Moneda',
    },
  },
  'entity-specification': {
    label: 'Especificación',
    plural: 'Especificaciones',
    fields: {
      id: 'ID',
      name: 'Nombre',
      version: 'Versión',
      released: 'Publicada',
    },
  },
  'characteristic-specification': {
    label: 'Característica',
    plural: 'Características',
    fields: {
      id: 'ID',
      specificationId: 'ID de especificación',
      code: 'Código',
      valueType: 'Tipo de valor',
      termId: 'Término del diccionario',
    },
    values: {
      valueType: {
        string: 'Texto',
        number: 'Número',
        boolean: 'Sí/No',
        enum: 'Lista de valores',
      },
    },
  },
  'sales-channel': {
    label: 'Canal de venta',
    plural: 'Canales de venta',
    fields: {
      id: 'ID',
      name: 'Nombre',
      type: 'Tipo',
      status: 'Estado',
    },
    values: {
      type: {
        storefront: 'Tienda en línea',
        counter: 'Mostrador',
        phone: 'Teléfono',
        external: 'Externo',
      },
      status: {
        active: 'Activo',
        inactive: 'Inactivo',
      },
    },
  },
  'stock-item': {
    label: 'Existencia',
    plural: 'Existencias',
    fields: {
      id: 'ID',
      offeringId: 'ID de oferta',
      onHand: 'En almacén',
      reserved: 'Reservado',
    },
  },
  'stock-movement': {
    label: 'Movimiento de existencias',
    plural: 'Movimientos de existencias',
    fields: {
      id: 'ID',
      offeringId: 'ID de oferta',
      quantity: 'Cantidad',
      reason: 'Motivo',
    },
    values: {
      reason: {
        receipt: 'Recepción',
        sale: 'Venta',
        cancellation: 'Cancelación',
        adjustment: 'Ajuste',
      },
    },
  },
  reservation: {
    label: 'Reserva',
    plural: 'Reservas',
    fields: {
      id: 'ID',
      offeringId: 'ID de oferta',
      quantity: 'Cantidad',
      status: 'Estado',
      expiresAt: 'Vence el',
    },
    values: {
      status: {
        held: 'Retenida',
        converted: 'Convertida',
        released: 'Liberada',
      },
    },
  },
};
