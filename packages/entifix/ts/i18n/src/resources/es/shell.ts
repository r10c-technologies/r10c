/** Copy owned by the Next shells — back-office chrome and the tab workspace. */
export const shell = {
  /**
   * The identity surface — user administration and the signed-in
   * account. The screens live in `@r10c/shells-next-auth` so a second
   * host can mount them, and copy follows the code: an `app:` key is
   * lint-restricted to `apps/`, so a shell binding one fails the build.
   * What stays in `app:auth` is the sign-in page itself, which is the
   * host's own front door rather than the domain's surface.
   */
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
  /**
   * System management — the operator surface. Lives in a `scope:shared` shell so
   * a dedicated management app can mount the same screens later, which is why the
   * copy is here rather than in an app catalog.
   */
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
  nav: {
    primary: 'Principal',
    openInWorkspace: 'Abrir {{label}} en el espacio de trabajo',
    openInWorkspaceShort: 'Abrir en el espacio de trabajo',
  },
  sidebar: {
    expand: 'Expandir barra lateral',
    collapse: 'Contraer barra lateral',
  },
  breadcrumbs: {
    home: 'Inicio',
    // The `/new` segment, which every domain's create route shares. It was
    // an auth-specific string until one host started serving two domains,
    // at which point a catalog page's breadcrumb read "New user".
    new: 'Nuevo',
  },
  /**
   * The account surface. The auth shell owns the screens, but `ACCOUNT_DESTINATIONS`
   * — the one list every app builds its menu from — lives in the shell, so the
   * shell owns their names too and resolves them itself.
   */
  account: {
    profile: 'Perfil',
    security: 'Seguridad',
    sessions: 'Sesiones',
    signOut: 'Cerrar sesión',
  },
  workspace: {
    copyLink: 'Copiar enlace',
    empty:
      'No hay pestañas abiertas. Elige un catálogo en la barra lateral para empezar.',
    unsupported: 'Esta pestaña no se puede abrir aquí.',
    discard: '¿Descartar los cambios sin guardar de esta pestaña?',
  },
  /**
   * The storefront. Its pages live in `shells-next-marketplace`, so its copy
   * lives here and not in an app catalog — `app:` is reserved for `apps/`.
   */
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
    },
    footer: {
      note: 'Catálogo de demostración. Ningún pedido es real.',
    },
  },
};
