/** Copy owned by the Next shells — back-office chrome and the tab workspace. */
export const shell = {
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
  },
  /**
   * The account surface. auth-app owns the screens, but `ACCOUNT_DESTINATIONS`
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
