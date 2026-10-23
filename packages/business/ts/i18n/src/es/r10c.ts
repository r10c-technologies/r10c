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
      total: 'Artículos en total',
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
      cancelFailed:
        'No se pudo cancelar el pedido. Puede que el plazo haya terminado o que ya vaya en camino.',
    },
    footer: {
      note: 'Catálogo de demostración. Ningún pedido es real.',
    },
  },
};
