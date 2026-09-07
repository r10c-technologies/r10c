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
  nav: {
    primary: 'Principal',
    openInWorkspace: 'Abrir {{label}} en el espacio de trabajo',
    openInWorkspaceShort: 'Abrir en el espacio de trabajo',
    openInNewTab: 'Abrir {{label}} en una pestaña nueva',
    openInNewTabShort: 'Abrir en una pestaña nueva',
    /**
     * The screen taxonomy (ADR 0033) — the sidebar's top tier, above the
     * domain. `Definiciones` rather than `Maestros` because the ERP term needs
     * the ERP background to parse, and rather than `Catálogos` or `Referencias`
     * because both already mean something else here: the product catalog, and a
     * product's code in `storefront.category.sortByCode`.
     */
    screenType: {
      master: 'Definiciones',
      operation: 'Operaciones',
      wizard: 'Asistentes',
      report: 'Consultas',
    },
  },
  /**
   * La paleta de comandos (ADR 0044). Vive en `shell:` y no en `controls:`
   * porque el control es agnóstico —recibe copia ya resuelta— y quien la
   * arma es el back office.
   */
  commandPalette: {
    /** El disparador visible, que existe justo porque un atajo puede fallar. */
    open: 'Buscar o ejecutar',
    /** El nombre accesible del diálogo y de su campo. */
    title: 'Buscar o ejecutar',
    placeholder: 'Busca un registro, una pantalla o un comando…',
    newPlaceholder: '¿Qué quieres crear?',
    newLabel: 'Nuevo…',
    /** El nombre de la página apilada, y también el del control para volver. */
    newTitle: 'Nuevo',
    back: 'Volver',
    empty: 'Sin resultados',
    loading: 'Buscando…',
    more_one: '{{count}} más',
    more_other: '{{count}} más',
    /** Escribe al menos dos caracteres — el suelo que impone `/api/search`. */
    typeMore: 'Escribe al menos {{count}} caracteres para buscar registros.',
    groups: {
      actions: 'Acciones',
      commands: 'Comandos',
      navigation: 'Navegación',
      tabs: 'Pestañas abiertas',
      records: 'Registros',
    },
    /**
     * Dos redacciones para dos cosas distintas: «no es tuyo» es el estado
     * **normal** de un operador sin organización, y pintarlo como avería en
     * cada tecleo enseña a ignorar el aviso que sí importa.
     */
    unavailableScope: 'No disponible aquí: {{reason}}',
    unavailableReach: 'No pudimos consultar este origen: {{reason}}',
    /** Sufijo del comando que abre un destino como pestaña del espacio. */
    openInWorkspaceHint: 'Pestaña',
  },
  sidebar: {
    expand: 'Expandir barra lateral',
    collapse: 'Contraer barra lateral',
    openMenu: 'Abrir el menú',
    closeMenu: 'Cerrar el menú',
    // The drawer is a dialog, so it needs a name of its own — the landmark
    // inside it is the nav, and a dialog with no accessible name is announced
    // as just "dialog".
    menu: 'Menú de navegación',
    expandGroup: 'Desplegar {{group}}',
    collapseGroup: 'Plegar {{group}}',
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
    // The confirmation that guards closing a dirty tab. The title carries the
    // question, so the message states the consequence rather than repeating it
    // — it was phrased as a question while `window.confirm` rendered it, which
    // had nowhere to put a title.
    discardTitle: 'Descartar cambios',
    discard:
      'Esta pestaña tiene cambios sin guardar. Si la cierras, se perderán.',
    discardConfirm: 'Descartar',
    // What became of a write the server has not finished. `count` is the
    // number in flight; a failure names no reason here, because the only one a
    // transaction carries is a server exception string in whatever language it
    // was written in — that is rendered beside this, unlocalized and marked so.
    pendingLabel: 'Estado de los guardados',
    savePending_one: 'Guardando 1 registro…',
    savePending_other: 'Guardando {{count}} registros…',
    saveFailed: 'No se pudo guardar el registro.',
    saveFailedDismiss: 'Descartar',
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
