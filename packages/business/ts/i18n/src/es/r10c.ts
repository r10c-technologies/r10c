/**
 * Copy for the screens r10c's own shells render: the identity surface (user
 * administration and the signed-in account) and the storefront.
 *
 * Until entifix 0.5.0 both lived inside the framework's `shell` namespace,
 * which rendered neither — only these shells read them. They are r10c's
 * product copy, so they are r10c's namespace (ADR 0060).
 */
export const r10c = {
  auth: {
    nav: {
      identity: 'Identidad',
      users: 'Usuarios',
      accountSection: 'Cuenta',
    },
    account: {
      overline: 'Cuenta',
      title: 'Mi cuenta',
      subtitle: 'Tu identidad y tu acceso a la flota r10c.',
      menu: 'Cuenta',
      identifiers: 'Identificadores',
      noIdentifiers: 'Sin identificadores registrados.',
      userId: 'ID de usuario',
      subject: 'Sujeto',
      session: 'Sesión',
      roles: 'Roles',
      none: 'Ninguno',
      failed: 'No pudimos cargar tu cuenta.',
    },
    sessions: {
      overline: 'Seguridad',
      title: 'Sesiones activas',
      subtitle: 'Dónde has iniciado sesión. Cierra las que no reconozcas.',
      current: 'Este dispositivo',
      unknownDevice: 'Dispositivo desconocido',
      startedAt: 'Iniciada',
      expiresAt: 'Expira',
      lastIp: 'IP',
      revoke: 'Cerrar',
      revoking: 'Cerrando…',
      revokeOthers: 'Cerrar las demás',
      empty: 'No hay otras sesiones activas.',
      failed: 'No pudimos cargar tus sesiones.',
      loading: 'Cargando sesiones…',
    },
    security: {
      overline: 'Seguridad',
      title: 'Contraseña y acceso',
      subtitle:
        'Tu contraseña, tu segundo factor y tus cuentas vinculadas viven en r10c Identity.',
      explain:
        'r10c no guarda tu contraseña. Adminístrala, junto con la verificación en dos pasos y tus accesos sociales, en el proveedor de identidad.',
      manage: 'Administrar en r10c Identity',
    },
    fields: {
      displayName: 'Nombre visible',
      email: 'Correo',
      username: 'Usuario',
      role: 'Rol',
    },
    submit: {
      wait: 'Espera…',
      creating: 'Creando…',
      createUser: 'Crear usuario',
    },
    users: {
      title: 'Usuarios',
      newTitle: 'Nuevo usuario',
      fallbackName: 'Usuario',
      sessionsTitle: 'Sesiones de este usuario',
      sessionsEmpty: 'Este usuario no tiene sesiones activas.',
      sessionsFailed: 'No pudimos cargar las sesiones de este usuario.',
      kick: 'Cerrar todas sus sesiones',
      kicking: 'Cerrando…',
    },
  },
  storefront: {
    nav: {
      catalog: 'Catálogo',
    },
    breadcrumbs: {
      label: 'Ruta de navegación',
      home: 'Inicio',
    },
    home: {
      overline: 'Tienda',
      heading: 'Marketplace r10c',
      lead: 'Objetos para la casa, elegidos de a poco.',
      featured: 'Destacados',
    },
    category: {
      overline: 'Categoría',
      empty: 'No hay productos en esta categoría todavía.',
      sort: 'Ordenar',
      sortByName: 'Nombre',
      sortByCode: 'Referencia',
      results: '{{count}} productos',
      previous: 'Anterior',
      next: 'Siguiente',
      pageOf: 'Página {{page}} de {{pages}}',
      children: 'Subcategorías',
    },
    product: {
      addToCart: 'Añadir al carrito',
      view: 'Ver producto',
      brand: 'Marca',
      category: 'Categoría',
      reference: 'Referencia',
      related: 'También te puede interesar',
      /**
       * `availableHint` es una **pista**, y el nombre lo dice: el catálogo
       * publicado es consistente en diferido a propósito y la verdad es la
       * reserva del checkout (ADR 0009). Por eso la copia no promete
       * existencias concretas.
       */
      available: 'Disponible',
      unavailable: 'Sin existencias',
      gallery: 'Imágenes del producto',
    },
    search: {
      heading: 'Buscar',
      label: 'Buscar productos',
      placeholder: 'Lámpara, taza, manta…',
      submit: 'Buscar',
      resultsFor: 'Resultados para «{{term}}»',
      empty: 'No encontramos nada para «{{term}}».',
      prompt: 'Escribe algo para empezar a buscar.',
    },
    cart: {
      heading: 'Carrito',
      empty: 'Tu carrito está vacío.',
      remove: 'Quitar',
      units: 'Cant. {{count}}',
      total: 'Total',
      keepShopping: 'Seguir comprando',
      checkout: 'Finalizar compra',
    },
    checkout: {
      placed: 'Tu pedido quedó registrado. Ya se notificó al vendedor.',
      unavailable:
        'Uno de estos productos ya no está disponible en la cantidad que pediste. No se cobró nada y se liberaron todas las reservas.',
      empty: 'Ninguno de estos productos sigue a la venta.',
      failed: 'No se pudo completar la compra. Inténtalo de nuevo.',
    },
    order: {
      heading: '¡Gracias por tu compra!',
      placed: 'Tu pedido quedó registrado y el vendedor ya fue notificado.',
      reference: 'Número de pedido',
      units: 'Cant. {{count}}',
      total: 'Total',
      tooManyLines:
        'Este pedido tiene {{count}} artículos, demasiados para mostrarlos aquí. El número de pedido de arriba los identifica a todos.',
      keepShopping: 'Seguir comprando',
      expiredHeading: 'No hay ningún pedido que mostrar',
      expired:
        'El comprobante de tu última compra ya no está disponible en este navegador. Si acabas de comprar, revisa el correo de confirmación.',
      // El plazo se nombra en vez de dejar que el botón deje de funcionar solo:
      // el comprobante lleva la fecha que el servidor selló, y las dos
      // concuerdan porque `RECEIPT_TTL_SECONDS` y el ajuste del servicio son un
      // solo número (ADR 0058 §5).
      cancel: 'Cancelar pedido',
      cancelWindow: 'Puedes cancelar este pedido hasta las {{time}}.',
      cancelPending: 'Cancelando…',
      cancelledHeading: 'Pedido cancelado',
      cancelled:
        'Cancelamos tu pedido y el reembolso ya va en camino. Puede tardar unos días en aparecer en tu estado de cuenta.',
      cancelPaymentPending:
        'Tu pago todavía se está confirmando, así que aún no se puede cancelar el pedido. Inténtalo de nuevo en un momento.',
      cancelFailed:
        'No se pudo cancelar el pedido. Puede que el plazo haya terminado o que ya vaya en camino.',
    },
    footer: {
      note: 'Catálogo de demostración. Ningún pedido es real.',
    },
  },
  /**
   * System management — the operator surface. Lives in the framework shell so
   * a dedicated management app can mount the same screens later, which is why the
   * copy is here rather than in an app catalog.
   */
  /**
   * La superficie de existencias — las primeras pantallas de Operaciones del
   * back office.
   *
   * El *nombre del nivel* ("Operaciones") sale de `nav.screenType.operation`;
   * esto nombra el grupo dentro de él.
   */
  stock: {
    nav: {
      stock: 'Existencias',
      items: 'Existencias en almacén',
      movements: 'Libro de movimientos',
      reservations: 'Reservas',
    },
  },
  order: {
    nav: {
      orders: 'Pedidos',
    },
  },
  settlement: {
    nav: {
      // El mismo nombre de grupo en las dos gradas: un acuerdo se redacta
      // (Definiciones) y el resto lo produce un proceso (Operaciones). El
      // encabezado de cada grada sale de `nav.screenType`.
      settlement: 'Liquidaciones',
      agreements: 'Acuerdos',
      entries: 'Apuntes de comisión',
      runs: 'Liquidaciones',
      payouts: 'Pagos a vendedores',
    },
    agreement: {
      channelRatesHint:
        'Déjalo en blanco para cobrar la comisión por defecto en ese canal. Un 0 significa que no se cobra nada.',
      channelRateDefault: 'Por defecto',
      noChannelRates: 'Sin tarifas por canal',
    },
  },
  sales: {
    nav: {
      sales: 'Ventas',
      channels: 'Canales de venta',
      guided: 'Ventas',
      counterSale: 'Vender en mostrador',
    },
    counterSale: {
      title: 'Venta en mostrador',
      steps: {
        channel: 'Canal',
        lines: 'Productos',
        payment: 'Cobro',
        summary: 'Resumen',
      },
      channelHint: 'Elige el canal por el que se hace esta venta.',
      linesHint: 'Agrega los productos publicados que estás vendiendo.',
      addLine: 'Agregar producto',
      removeLine: 'Quitar',
      quantity: 'Cantidad',
      offering: 'Producto',
      total: 'Total',
      paymentMethod: 'Forma de pago',
      charge: 'Cobrar',
      sold: 'Venta registrada',
      soldDetail: 'La existencia ya se descontó y el pedido quedó registrado.',
      newSale: 'Nueva venta',
      emptyLines: 'Agrega al menos un producto para cobrar.',
    },
  },
  marketplaceAdmin: {
    nav: {
      // Moved out of the `app:` catalog with the nav table itself: this copy
      // belongs to the shell that owns the screens, so a second host mounting
      // it does not re-translate them.
      catalog: 'Catálogo',
      products: 'Productos',
      brands: 'Marcas',
      categories: 'Categorías',
      offerings: 'Ofertas comerciales',
      offeringPrices: 'Precios de oferta',
      // La sección Asistentes. El *nombre del nivel* ("Asistentes") sale de
      // `nav.screenType.wizard`; esto nombra el grupo dentro de él.
      guided: 'Catálogo',
    },
    /**
     * El asistente de alta de producto. Los nombres de los pasos son de este
     * dominio, no del control — por eso viven acá y no en `controls`.
     */
    wizard: {
      productSetup: {
        title: 'Nuevo producto',
        launch: 'Nuevo producto guiado',
        steps: {
          start: 'Origen',
          source: 'Producto base',
          identity: 'Identificación',
          classification: 'Clasificación',
          summary: 'Resumen',
        },
        start: {
          question: '¿Cómo querés empezar?',
          blank: 'Desde cero',
          blankHint: 'Cargar los datos a mano.',
          duplicate: 'Duplicar uno existente',
          duplicateHint:
            'Partir de un producto ya cargado. El código no se copia: identifica al original.',
        },
        source: {
          prompt: 'Elegí el producto del que querés partir.',
          chosen: 'Producto base: {{name}}',
          required: 'Elegí un producto para continuar.',
        },
        summary: {
          prompt: 'Revisá lo cargado antes de crearlo.',
          origin: 'Origen',
          originBlank: 'Desde cero',
          originDuplicate: 'Duplicado de {{name}}',
          empty: 'Sin definir',
        },
        recap: 'Ya habías respondido:',
      },
    },
  },
  systemManagement: {
    nav: {
      section: 'Sistema',
      configuration: 'Configuración',
    },
    configuration: {
      title: 'Configuración de la plataforma',
      description:
        'Parámetros que cada servicio resuelve al arrancar. Editar un valor afecta al servicio en su próximo arranque.',
      secretPlaceholder: '•••••• (sin cambios)',
      secretHint:
        'Dejar en blanco mantiene el valor guardado. Escribir uno nuevo lo reemplaza.',
    },
  },
};
