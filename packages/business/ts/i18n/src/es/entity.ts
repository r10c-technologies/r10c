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
      media: 'Imágenes',
      fitsDeviceModelIds: 'Teléfonos compatibles',
      specKey: 'Serie',
      version: 'Versión',
      lifecycleStatus: 'Estado',
      validFrom: 'Lanzada el',
      validTo: 'Retirada el',
      contentHash: 'Huella del contenido',
    },
    values: {
      lifecycleStatus: {
        'in-design': 'En diseño',
        active: 'Activa',
        retired: 'Retirada',
        obsolete: 'Obsoleta',
      },
    },
    useCases: {
      release: 'Lanzar',
      releaseConfirm:
        'Esta versión pasa a ser la que se vende y queda congelada: para cambiarla después crearás una nueva versión. La versión activa anterior se retira.',
      revise: 'Nueva versión',
      retire: 'Retirar',
      retireConfirm:
        'Ninguna oferta nueva podrá usar esta versión. Las ofertas que ya la usan siguen vendiéndose.',
      obsolete: 'Marcar obsoleta',
      obsoleteConfirm:
        'Esta versión se conserva para los pedidos que la nombran y ya no puede usarse.',
    },
  },
  'price-tier': {
    fields: {
      from: 'Desde',
      amount: 'Precio',
    },
  },
  'media-reference': {
    fields: {
      url: 'URL de la imagen',
      alt: 'Descripción de la imagen',
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
  'device-model': {
    form: {
      editTitle: 'Editar modelo de teléfono',
      newTitle: 'Nuevo modelo de teléfono',
    },
    label: 'Modelo de teléfono',
    plural: 'Modelos de teléfono',
    fields: {
      id: 'ID',
      code: 'Código',
      name: 'Nombre',
      maker: 'Fabricante',
      status: 'Estado',
    },
    useCases: {
      restore: 'Restaurar',
      retire: 'Retirar',
      retireConfirm:
        'Estos modelos dejarán de ofrecerse al clasificar productos. Las ofertas ya publicadas con ellos no cambian.',
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
      status: 'Estado',
    },
    // "Retirar", no "Eliminar": el registro sigue existiendo y las ofertas ya
    // clasificadas con él siguen resolviendo — lo que cambia es que deja de
    // ofrecerse para clasificar nuevas.
    useCases: {
      restore: 'Restaurar',
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
      parentId: 'Categoría superior',
    },
    useCases: {
      restore: 'Restaurar',
      retire: 'Retirar',
      retireConfirm:
        'Estas categorías dejarán de ofrecerse al clasificar productos y desaparecerán del árbol de navegación. Las ofertas ya publicadas con ellas no cambian.',
    },
  },
  'user-identity': {
    label: 'Usuario',
    plural: 'Usuarios',
    // Whole phrases rather than a verb plus `label`, for the reason recorded on
    // the form titles above. Every session verb says "Cerrar", never
    // "Revocar" — `user-device`'s `signOutSession` below included.
    useCases: {
      revokeSessions: 'Cerrar todas las sesiones',
      revokeSessionsConfirm:
        'Se cerrarán todas las sesiones de este usuario en todos sus dispositivos. Recibirá un aviso por correo.',
      updateAspects: 'Cambiar rol y estado',
      /**
       * El hermano *unbound* de `revokeSessions`: aquél cierra las sesiones de
       * otra persona, éste las tuyas. La etiqueta dice «mis» precisamente
       * porque en la paleta no hay ningún registro seleccionado que aclare de
       * quién se habla.
       */
      signOutOthers: 'Cerrar mis otras sesiones',
      /**
       * Lista separada por comas — `parseKeywords` la parte. Están en inglés
       * a propósito: son los términos que alguien teclea sin cambiar de idioma,
       * y es justo para eso que `keywordsKey` es una clave de catálogo y no un
       * `string[]` en el decorador.
       */
      signOutOthersKeywords: 'logout, sign out, cerrar sesion, dispositivos',
      signOutOthersConfirm:
        'Se cerrarán todas tus sesiones en otros dispositivos y navegadores. Ésta seguirá abierta.',
      switchOrganization: 'Cambiar de organización',
      switchOrganizationKeywords:
        'organization, switch, cambiar, organizacion, empresa',
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
    useCases: {
      signOutSession: 'Cerrar esta sesión',
      signOutSessionConfirm:
        'Se cerrará la sesión en este dispositivo y quien la use tendrá que volver a iniciar sesión. Si es ésta, saldrás ahora.',
    },
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
    useCases: {
      setFiscalIdentity: 'Guardar datos fiscales',
      setPaymentLinkAcceptance: 'Guardar enlaces de pago',
      setWhatsappNumber: 'Guardar WhatsApp',
    },
    fields: {
      id: 'ID',
      name: 'Nombre',
      slug: 'Identificador',
      status: 'Estado',
      taxId: 'NIT',
      legalName: 'Razón social',
      taxRegime: 'Régimen tributario',
      establishmentCode: 'Código de establecimiento',
      acceptsPaymentLink: 'Acepta enlaces de pago',
      whatsappNumber: 'WhatsApp',
      sampleStore: 'Tienda de muestra',
      updatedAt: 'Última actualización',
    },
    values: {
      taxRegime: {
        general: 'IVA general',
        'small-taxpayer': 'Pequeño contribuyente',
        simplified: 'Opcional simplificado',
      },
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
      organizationId: 'ID de organización',
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
  'published-vendor': {
    label: 'Vendedor publicado',
    plural: 'Vendedores publicados',
    fields: {
      id: 'ID',
      vendorId: 'ID del vendedor',
      displayName: 'Vendedor',
      announcedAt: 'Anunciado el',
      acceptsCod: 'Acepta pago contra entrega',
      holdsStock: 'Maneja inventario',
      acceptsLink: 'Acepta links de pago',
      whatsappNumber: 'WhatsApp',
      sampleStore: 'Tienda de muestra',
      taxId: 'NIT',
      legalName: 'Razón social',
      taxRegime: 'Régimen tributario',
      establishmentCode: 'Código de establecimiento',
    },
  },
  'published-offering': {
    label: 'Oferta publicada',
    plural: 'Ofertas publicadas',
    useCases: {
      // En diseño (ADR 0082): el registro de capacidades ya lo nombra.
      filterByDevice: 'Filtrar por dispositivo',
    },
    fields: {
      id: 'ID',
      offeringId: 'ID de oferta',
      vendorId: 'ID de vendedor',
      name: 'Nombre',
      amount: 'Importe',
      currency: 'Moneda',
      pricePer: 'Precio por',
      tiers: 'Precios por volumen',
      amountPerThousand: 'Importe por mil',
      saleUnit: 'Unidad de venta',
      quantityStep: 'Se vende de',
      quantityMinimum: 'Cantidad mínima',
      stockOfferingId: 'Toma su inventario de',
      stockFactor: 'Unidades base por cada una',
      stockUnit: 'Unidad base',
      availableHint: 'Disponibilidad estimada',
      publishedAt: 'Publicada el',
      specificationId: 'ID de la versión del producto',
      specificationVersion: 'Versión del producto',
      // La referencia de la especificación fijada, no la dirección: la URL de la
      // tienda se arma con `offeringId`, porque varias ofertas pueden fijar una
      // misma especificación.
      code: 'Referencia',
      description: 'Descripción',
      brandId: 'ID de marca',
      fitsDeviceModelIds: 'Teléfonos compatibles',
      categoryId: 'ID de categoría',
      media: 'Imágenes',
    },
  },
  'checkout-group': {
    // Lo abre el flujo de compra, nunca una persona; el comprador lo lee como su
    // recibo entre vendedores, y un vendedor no lo lee nunca.
    form: {
      editTitle: 'Compra',
      newTitle: 'Compra',
    },
    label: 'Compra',
    plural: 'Compras',
    fields: {
      id: 'ID',
      number: 'Número',
      buyerId: 'ID de comprador',
      orderIds: 'Pedidos',
      totals: 'Totales',
      total: {
        amount: 'Importe',
        currency: 'Moneda',
      },
      placedAt: 'Fecha de la compra',
      cancelDigest: 'Huella de cancelación',
      cancelWindowEndsAt: 'Fin del plazo de cancelación',
      receiptEndsAt: 'Recibo disponible hasta',
      accessDigest: 'Huella del enlace de acceso',
      accessExpiresAt: 'Enlace de acceso válido hasta',
      accessSentAt: 'Enlace de acceso enviado',
      contact: 'Contacto y entrega',
      buyer: {
        name: 'Nombre',
        phone: 'Teléfono',
        email: 'Correo',
        departamento: 'Departamento',
        municipio: 'Municipio',
        zona: 'Zona',
        addressLine: 'Dirección',
        reference: 'Referencia',
      },
      locale: 'Idioma',
      redactedAt: 'Datos personales eliminados el',
    },
    useCases: {
      sendAccessLink: 'Enviar un enlace de acceso',
    },
  },
  'product-order': {
    // Un título de formulario para un registro que nadie crea a mano, igual que
    // `stock-item`. `newTitle` es la puerta que lee `EntityCatalogKey`, no la
    // promesa de un botón Nuevo: ningún rol tiene `product-order:write`.
    form: {
      editTitle: 'Pedido',
      newTitle: 'Pedido',
    },
    label: 'Pedido',
    plural: 'Pedidos',
    fields: {
      id: 'ID',
      number: 'Número',
      buyerId: 'ID de comprador',
      vendorId: 'Vendedor',
      groupId: 'Compra',
      paymentMethod: 'Pago',
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
        name: 'Vendido como',
        description: 'Descripción vendida',
        specificationId: 'ID de la versión del producto',
        specificationVersion: 'Versión del producto',
        saleUnit: 'Unidad',
        pricePer: 'Precio por',
        tierFrom: 'Precio por volumen desde',
        stockOfferingId: 'Tomado de',
        stockUnit: 'Unidad base',
        stockQuantity: 'Tomado del inventario',
        lineTotal: 'Total de la línea',
        quantity: 'Cantidad',
        amount: 'Importe',
        currency: 'Moneda',
        reservationId: 'ID de reserva',
        kind: 'Tipo',
        taxTreatment: 'Tratamiento fiscal',
        taxRate: 'Tasa de IVA',
        taxableBase: 'Base imponible',
        taxAmount: 'IVA',
      },
      paymentEvidence: 'Comprobantes de pago',
      /** Los miembros de un comprobante adjunto (ADR 0081 §6). */
      evidence: {
        id: 'ID del comprobante',
        objectKey: 'Archivo',
        contentType: 'Tipo de archivo',
        byteSize: 'Tamaño',
        sha256: 'Huella SHA-256',
        attachedBy: 'Adjuntado por',
        attachedAt: 'Adjuntado el',
        redactedAt: 'Borrado el',
      },
      channel: 'Canal de venta',
      placedAt: 'Fecha del pedido',
      paidAt: 'Fecha de pago',
      paymentDueAt: 'Pago esperado hasta',
      paymentReference: 'Número de autorización',
      paymentConfirmedBy: 'Pago confirmado por',
      paymentConfirmedAt: 'Pago confirmado el',
      paymentLinkUrl: 'Link de pago',
      paymentLinkProviderKey: 'Clave del proveedor del link',
      paymentLinkProviderName: 'Proveedor del link',
      paymentLinkSetBy: 'Link puesto por',
      paymentLinkSetAt: 'Link puesto el',
      courierName: 'Paquetería',
      trackingNumber: 'Guía',
      trackingUrl: 'Rastreo',
      dispatchedAt: 'Despachado el',
      fulfilledAt: 'Entregado el',
      cancelCause: 'Motivo de cancelación',
      // Los hechos fiscales que el pedido fija al cobrarse (#659–#661).
      sellerTaxId: 'NIT del vendedor',
      sellerLegalName: 'Razón social del vendedor',
      sellerTaxRegime: 'Régimen del vendedor',
      sellerEstablishmentCode: 'Establecimiento',
      buyerTaxIdType: 'Identificación del comprador',
      buyerTaxId: 'NIT o CUI del comprador',
      buyerTaxName: 'Nombre para la factura',
      netAmount: 'Subtotal sin IVA',
      taxAmount: 'IVA',
      totalAmount: 'Total',
      currency: 'Moneda',
      // El documento FEL que certifica la venta y su anulación (#668).
      fiscalDocumentType: 'Tipo de documento',
      fiscalAuthorization: 'Autorización FEL',
      fiscalSeries: 'Serie',
      fiscalNumber: 'Número de documento',
      fiscalCertifiedAt: 'Certificado el',
      fiscalVoidAuthorization: 'Autorización de anulación',
      fiscalVoidedAt: 'Anulado el',
      fiscalAttemptAt: 'Último intento de certificación',
      fiscalFailure: 'Motivo del último rechazo',
    },
    values: {
      fiscalDocumentType: {
        FACT: 'Factura (FACT)',
        FPEQ: 'Factura pequeño contribuyente (FPEQ)',
      },
      buyerTaxIdType: {
        nit: 'NIT',
        cui: 'CUI (DPI)',
        cf: 'Consumidor final (CF)',
      },
      item: {
        kind: { good: 'Bien', service: 'Servicio' },
        taxTreatment: { taxed: 'Gravado', exempt: 'Exento' },
      },
      status: {
        pending: 'Pendiente',
        'awaiting-payment': 'Esperando pago',
        paid: 'Pagado',
        confirmed: 'Confirmado',
        cancelling: 'Cancelando',
        dispatched: 'Despachado',
        fulfilled: 'Entregado',
        cancelled: 'Cancelado',
      },
      paymentMethod: {
        card: 'Tarjeta',
        cash: 'Efectivo',
        cod: 'Contra entrega',
        link: 'Link de pago',
      },
    },
    useCases: {
      confirmPayment: 'Confirmar pago',
      setPaymentLink: 'Poner link de pago',
      attachPaymentEvidence: 'Adjuntar comprobante de pago',
      cancel: 'Cancelar pedido',
      cancelConfirm:
        'Se devolverá el dinero al comprador y las unidades volverán a tu inventario. Esto no se puede deshacer: volver a cobrar es una compra nueva.',
    },
  },
  payment: {
    label: 'Pago',
    plural: 'Pagos',
    fields: {
      id: 'ID',
      groupId: 'ID de la compra',
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
        cod: 'Contra entrega',
        link: 'Enlace de pago',
      },
    },
  },
  'payment-allocation': {
    label: 'Asignación de pago',
    plural: 'Asignaciones de pago',
    fields: {
      id: 'ID',
      paymentId: 'ID del pago',
      groupId: 'ID de la compra',
      orderId: 'ID del pedido',
      vendorId: 'ID del vendedor',
      authorized: 'Autorizado',
      captured: 'Cobrado',
      refunded: 'Reembolsado',
      currency: 'Moneda',
      paymentMethod: 'Método de pago',
      taxableBase: 'Base imponible',
      taxAmount: 'IVA',
      taxRegime: 'Régimen del vendedor',
    },
  },
  refund: {
    label: 'Reembolso',
    plural: 'Reembolsos',
    fields: {
      id: 'ID',
      allocationId: 'ID de la asignación',
      orderId: 'ID de pedido',
      amount: 'Importe',
      currency: 'Moneda',
      status: 'Estado',
      providerReference: 'Referencia del proveedor',
      decidedAt: 'Fecha de resolución',
      taxableBase: 'Base imponible',
      taxAmount: 'IVA',
    },
    values: {
      status: {
        pending: 'Pendiente',
        refunded: 'Reembolsado',
        failed: 'Fallido',
      },
    },
  },
  agreement: {
    // El único formulario editable del dominio, y lo edita el operador: fijar
    // la comisión de un vendedor no es un acto del propio vendedor.
    form: {
      editTitle: 'Editar acuerdo',
      newTitle: 'Nuevo acuerdo',
    },
    label: 'Acuerdo',
    plural: 'Acuerdos',
    fields: {
      id: 'ID',
      vendorId: 'Vendedor',
      commissionBasisPoints: 'Comisión (puntos básicos)',
      channelCommissionBasisPoints: 'Comisión por canal (puntos básicos)',
      effectiveFrom: 'Vigente desde',
    },
  },
  'commission-entry': {
    // ⚠️ Un título de formulario para un registro que nadie crea a mano, como
    // el de `stock-item`: lo escribe la conciliación cuando se cobra una venta.
    // `newTitle` es la condición del catálogo que `EntityCatalogKey` lee, no la
    // promesa de un botón Nuevo.
    form: {
      editTitle: 'Apunte de comisión',
      newTitle: 'Apunte de comisión',
    },
    label: 'Apunte de comisión',
    plural: 'Apuntes de comisión',
    fields: {
      collectedBy: 'Cobrado por',
      id: 'ID',
      orderId: 'ID de pedido',
      vendorId: 'Vendedor',
      saleAmount: 'Importe de la venta',
      commissionAmount: 'Importe de comisión',
      currency: 'Moneda',
      occurredAt: 'Fecha de la venta',
      runId: 'Corte de liquidación',
      kind: 'Tipo',
    },
    values: {
      collectedBy: {
        platform: 'Plataforma',
        vendor: 'Vendedor',
      },
      kind: {
        sale: 'Venta',
        reversal: 'Reverso',
      },
    },
  },
  'settlement-run': {
    // Un lote, no un registro que se redacte. Lo abre el barrido periódico o la
    // ruta que lo dispara a mano; la pantalla solo lo muestra.
    form: {
      editTitle: 'Liquidación',
      newTitle: 'Liquidación',
    },
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
    // Lo calcula una liquidación a partir de los apuntes del periodo. Nadie
    // escribe un pago a mano, y no hay permiso de escritura para hacerlo.
    form: {
      editTitle: 'Pago a vendedor',
      newTitle: 'Pago a vendedor',
    },
    label: 'Pago a vendedor',
    plural: 'Pagos a vendedores',
    fields: {
      id: 'ID',
      runId: 'Corte de liquidación',
      vendorId: 'Vendedor',
      amount: 'Importe',
      currency: 'Moneda',
    },
  },
  /**
   * Las unidades de venta (ADR 0082), en un solo sitio: la oferta, su versión
   * publicada, el inventario y el pedido nombran la misma unidad.
   */
  'sale-unit': {
    name: {
      UN: 'Unidad',
      PAR: 'Par',
      M: 'Metro',
      YD: 'Yarda',
      FT: 'Pie',
      M2: 'Metro cuadrado',
      FT2: 'Pie cuadrado',
      DM2: 'Decímetro cuadrado',
      KG: 'Kilogramo',
      LB: 'Libra',
      L: 'Litro',
      GAL: 'Galón',
    },
    symbol: {
      UN: 'u.',
      PAR: 'par',
      M: 'm',
      YD: 'yd',
      FT: 'ft',
      M2: 'm²',
      FT2: 'ft²',
      DM2: 'dm²',
      KG: 'kg',
      LB: 'lb',
      L: 'L',
      GAL: 'gal',
    },
  },
  'product-offering': {
    form: {
      editTitle: 'Editar oferta comercial',
      newTitle: 'Nueva oferta comercial',
    },
    label: 'Oferta comercial',
    plural: 'Ofertas comerciales',
    fields: {
      id: 'ID',
      name: 'Nombre',
      specificationId: 'Especificación',
      status: 'Estado',
      statusChangedAt: 'Último cambio de estado',
      saleUnit: 'Unidad de venta',
      quantityStep: 'Se vende de',
      quantityMinimum: 'Cantidad mínima',
      stockOfferingId: 'Toma su inventario de',
      stockFactor: 'Unidades base por cada una',
    },
    values: {
      status: {
        draft: 'Borrador',
        'pending-review': 'Pendiente de revisión',
        published: 'Publicada',
        unpublished: 'Retirada',
      },
    },
    useCases: {
      publish: 'Publicar',
      setSaleUnit: 'Definir unidad de venta',
      drawOnStock: 'Vender una presentación del mismo inventario',
      publishConfirm:
        'La oferta pasará a verse en la tienda con su precio actual. Volver a publicarla reemplaza por completo lo que ya se mostraba.',
      unpublish: 'Retirar',
      unpublishConfirm:
        'La oferta dejará de verse en la tienda y se eliminará del catálogo publicado. Tu versión no se borra: puedes volver a publicarla.',
    },
    related: {
      price: 'Precio',
      image: 'Imagen',
      available: 'Disponible',
    },
  },
  'product-offering-price': {
    form: {
      editTitle: 'Editar precio',
      newTitle: 'Nuevo precio',
    },
    label: 'Precio de oferta',
    plural: 'Precios de oferta',
    fields: {
      id: 'ID',
      offeringId: 'Producto',
      amount: 'Importe',
      currency: 'Moneda',
      pricePer: 'Precio por',
      tiers: 'Precios por volumen',
    },
    useCases: {
      setPriceTiers: 'Definir precios por volumen',
    },
  },
  'entity-specification': {
    label: 'Especificación',
    plural: 'Especificaciones',
    fields: {
      id: 'ID',
      name: 'Nombre',
      version: 'Versión',
      lifecycleStatus: 'Estado',
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
    form: {
      editTitle: 'Editar canal de venta',
      newTitle: 'Nuevo canal de venta',
    },
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
    useCases: {
      sell: 'Vender en este canal',
    },
  },
  'stock-item': {
    // ⚠️ Un título de formulario para un registro que nadie crea a mano.
    // `newTitle` es la condición del catálogo que `EntityCatalogKey` lee, no la
    // promesa de un botón Nuevo: no hay permiso `stock-item:write` ni ruta de
    // guardado, así que el descriptor servido no ofrece Guardar.
    form: {
      editTitle: 'Existencia',
      newTitle: 'Existencia',
    },
    label: 'Existencia',
    plural: 'Existencias',
    fields: {
      id: 'ID',
      offeringId: 'Producto',
      unit: 'Unidad',
      onHand: 'En almacén',
      reserved: 'Reservado',
      available: 'Disponible',
    },
  },
  'stock-movement': {
    // La única superficie de escritura del dominio: un movimiento, con
    // cantidad con signo y motivo. Registrar uno es como se mueve un total.
    form: {
      editTitle: 'Movimiento de existencias',
      newTitle: 'Registrar movimiento',
    },
    label: 'Movimiento de existencias',
    plural: 'Movimientos de existencias',
    fields: {
      id: 'ID',
      offeringId: 'Producto',
      unit: 'Unidad',
      quantity: 'Cantidad',
      reason: 'Motivo',
      occurredAt: 'Fecha',
      causeType: 'Origen',
      causeId: 'Referencia del origen',
    },
    values: {
      reason: {
        receipt: 'Recepción',
        sale: 'Venta',
        cancellation: 'Cancelación',
        return: 'Devolución',
        adjustment: 'Ajuste',
      },
      causeType: {
        manual: 'Manual',
        reservation: 'Reserva',
        'product-order': 'Pedido',
      },
    },
  },
  reservation: {
    // La escribe el cruce del checkout, nunca una persona — así que esto
    // titula un registro que se lee, y el caso "nueva" no llega a existir.
    form: {
      editTitle: 'Reserva',
      newTitle: 'Reserva',
    },
    label: 'Reserva',
    plural: 'Reservas',
    fields: {
      id: 'ID',
      offeringId: 'Producto',
      unit: 'Unidad',
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
  'shipping-order': {
    // Lo abre un flujo cuando un checkout se confirma, nunca una persona; el
    // vendedor lo mueve con los verbos de abajo.
    form: {
      editTitle: 'Envío',
      newTitle: 'Envío',
    },
    label: 'Envío',
    plural: 'Envíos',
    fields: {
      id: 'ID',
      orderId: 'Pedido',
      orderNumber: 'Número de pedido',
      destination: 'Entrega',
      recipient: {
        name: 'Recibe',
        phone: 'Teléfono',
        departamento: 'Departamento',
        municipio: 'Municipio',
        zona: 'Zona',
        addressLine: 'Dirección',
        reference: 'Referencia',
      },
      redactedAt: 'Datos de entrega eliminados el',
      groupId: 'Compra',
      flowId: 'Flujo',
      paymentMethod: 'Pago',
      amountDue: 'A cobrar en la entrega',
      taxableBase: 'Base imponible',
      taxAmount: 'Impuesto',
      taxRegime: 'Régimen fiscal',
      currency: 'Moneda',
      lines: 'Líneas',
      line: {
        offeringId: 'Producto',
        name: 'Vendido como',
        unit: 'Unidad',
        quantity: 'Cantidad',
        stockOfferingId: 'Tomado de',
        stockUnit: 'Unidad base',
        stockQuantity: 'Tomado del inventario',
      },
      status: 'Estado',
      dispatchedAt: 'Despachado el',
      deliveredAt: 'Entregado el',
      refusedAt: 'Rechazado el',
      returnedAt: 'Devuelto el',
      withdrawnAt: 'Retirado el',
      courierKey: 'Clave de la paquetería',
      courierName: 'Paquetería',
      trackingNumber: 'Guía',
      trackingUrl: 'Rastreo',
      guideRecordedAt: 'Guía registrada el',
    },
    values: {
      status: {
        'awaiting-dispatch': 'Por despachar',
        held: 'Retenido',
        dispatched: 'Despachado',
        delivered: 'Entregado',
        refused: 'Rechazado',
        returned: 'Devuelto',
        withdrawn: 'Retirado',
      },
      paymentMethod: {
        card: 'Tarjeta',
        cash: 'Efectivo',
        cod: 'Contra entrega',
      },
    },
    useCases: {
      dispatch: 'Despachar',
      dispatchConfirm:
        'El paquete se entrega al mensajero y el pedido ya no puede cancelarse. Solo un rechazo en la puerta devuelve la mercadería.',
      'record-delivery': 'Registrar entrega',
      'record-refusal': 'Registrar rechazo',
      recordRefusalConfirm:
        'El comprador rechazó el paquete, así que el pedido se cierra sin venta. No se puede deshacer; registre la devolución cuando el paquete esté con usted.',
      'record-return': 'Registrar devolución',
      'record-guide': 'Registrar guía',
      recordReturnConfirm:
        'La mercadería devuelta vuelve a su inventario y a la venta. No se puede deshacer.',
    },
  },
};
