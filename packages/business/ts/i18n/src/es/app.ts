/**
 * Copy owned by the three Next apps, one sub-tree per app.
 *
 * Only what an app authors. Chrome the shells render — breadcrumb root, the
 * account destinations, sign out — belongs to `shell`, and theme captions to
 * `controls`; nothing outside `apps/` may reference a key from here.
 */
export const app = {
  admin: {
    brand: 'r10c Admin',
    title: 'r10c · Administración del marketplace',
    description: 'Back-office del marketplace r10c.',
    /** The two palettes the account menu offers (#530). */
    themes: {
      ocean: 'Océano',
      midnight: 'Medianoche',
    },
    // El inicio del vendedor (#563): lo que requiere su atención hoy.
    home: {
      tiles: 'Pendientes de hoy',
      none: 'Cuando actúe por una organización, aquí verá lo que requiere su atención.',
    },
    nav: {
      // `//home`, where the proxy lands an authenticated visitor. Not the
      // breadcrumb root — that is the shell's `shell:breadcrumbs.home`.
      dashboard: 'Panel',
      account: 'Cuenta',
    },
    menu: {
      trigger: 'Admin',
      preferences: 'Preferencias',
      signOut: 'Cerrar sesión',
    },
    account: {
      title: 'Cuenta',
      signedIn: 'Sesión iniciada',
      verified: 'Identidad verificada por marketplace-admin-service.',
      failed:
        'No pudimos verificar tu sesión con el backend. Inicia sesión de nuevo.',
      userId: 'ID de usuario:',
      subject: 'Sujeto:',
      session: 'Sesión:',
      roles: 'Roles:',
      none: '(ninguno)',
      signingOut: 'Cerrando sesión…',
    },
    playground: 'Laboratorio del sistema de diseño',
  },
  auth: {
    brand: 'r10c Identity',
    title: 'r10c · Identidad',
    description: 'Inicia sesión en la flota r10c.',
    signIn: {
      overline: 'Identidad',
      title: 'Iniciar sesión',
      subtitle: 'Accede a la flota del marketplace r10c.',
      continue: 'Continuar',
      hosted:
        'Te llevaremos a r10c Identity para verificar tu identidad. Ahí puedes crear una cuenta, recuperarla o usar un segundo factor.',
      errors: {
        providerUnavailable: 'No pudimos contactar al proveedor de identidad.',
        invalidState: 'Ese enlace de acceso ya expiró. Vuelve a intentarlo.',
        accountInactive: 'Tu cuenta está suspendida.',
        accessDenied: 'Cancelaste el inicio de sesión.',
        invalidRequest: 'La respuesta del proveedor llegó incompleta.',
        unexpected: 'Algo falló al iniciar sesión.',
      },
    },
  },
  marketplace: {
    title: 'r10c · Marketplace',
    description: 'La tienda del marketplace r10c.',
    overline: 'Tienda',
    heading: 'Marketplace',
    lead: 'El mismo sistema de diseño entifix que la app de administración, con la paleta esmeralda propia de esta app. Cambia claro/oscuro abajo.',
    addToCart: 'Añadir al carrito',
    buttons: {
      title: 'Botones',
      subtitle: 'Los mismos átomos, con la marca de la tienda.',
      primary: 'Primario',
      secondary: 'Secundario',
      ghost: 'Fantasma',
      checkout: 'Pagar',
    },
    typography: {
      title: 'Tipografía',
      body: 'El texto base escala con el viewport y sigue la paleta activa.',
      caption:
        'Pie de foto — los colores de marca vienen del themes.css de esta app.',
    },
  },
  /**
   * The documentation site's own copy (apps/docs-site, #652 #653). Every page
   * of the site is generated from the capability and slice registers; this is
   * only the words around what they say.
   */
  docs: {
    brand: 'r10c',
    title: 'Documentación de r10c',
    description:
      'Qué hace r10c, quién puede hacerlo y dónde vive cada dato, generado desde el código.',
    languages: {
      title: 'Elige un idioma',
      es: 'Español',
      en: 'English',
    },
    home: {
      title: 'Inicio',
      description: 'Cuatro puertas al mismo registro, una por lector.',
      intro:
        'Cada caso de uso tiene una sola página, generada desde el registro de capacidades. Empieza por la entrada que te corresponde.',
      storybook: 'Componentes de la tienda (Storybook)',
      storybookNote:
        'Los componentes de la tienda, cada uno en sus estados, con su verificación de accesibilidad.',
    },
    audiences: {
      title: 'Para quién',
      developer: {
        title: 'Quien desarrolla',
        description:
          'Cada caso de uso por dominio, con los permisos que exige y los cruces entre servicios que usa.',
      },
      operator: {
        title: 'Quien opera la plataforma',
        description:
          'Qué rol concede cada permiso, y qué pasos hace un servicio en nombre de otro.',
      },
      merchant: {
        title: 'El comercio',
        description:
          'Lo que un vendedor puede hacer hoy, en qué pantalla, y lo que todavía no existe.',
      },
      evaluator: {
        title: 'Quien evalúa r10c',
        description:
          'Lo construido y lo planeado, contado desde el registro y no desde una promesa.',
      },
    },
    useCase: {
      id: 'Identificador',
      status: 'Estado',
      domain: 'Dominio',
      oda: 'Componente ODA',
      odaNone: 'Sin equivalente ODA',
      entities: 'Entidades',
      subject: 'sujeto',
      permissions: 'Permisos',
      crossing: 'cruce entre servicios',
      crossings: 'Cruces entre servicios',
      roles: 'Roles que lo conceden',
      noRole: 'Ningún rol: lo hace un servicio o el comprador',
      screens: 'Pantallas',
      noScreen: 'Ninguna pantalla: se invoca desde otra acción',
      verticals: 'Verticales',
      allVerticals: 'Todas',
      notBuilt:
        'Todavía no existe en el código. La fecha está en el hito, no aquí.',
      count: 'Casos de uso',
    },
    statuses: {
      implemented: 'Construido',
      planned: 'Planeado',
      'in-design': 'En diseño',
    },
    verticals: {
      hardware: 'Ferretería',
      'phone-accessories': 'Accesorios de celular',
      'shoemaking-supplies': 'Insumos de zapatería',
    },
    catalog: {
      title: 'Servicios',
      description:
        'Cada slice con lo que despliega, los stores que escribe y las APIs y eventos que expone, derivado de tools/slices.',
      storesTitle: 'Stores',
      storesDescription:
        'Cada store con su plano, su partición y su único escritor.',
      kind: 'Tipo',
      kinds: {
        domain: 'Dominio',
        system: 'Sistema',
        component: 'Componente',
        resource: 'Recurso',
        api: 'API',
      },
      slice: 'Slice',
      status: 'Estado',
      sliceStatuses: { active: 'Activo', planned: 'Planeado' },
      domains: 'Dominios',
      noDomain: 'Ninguno: es un slice de plataforma',
      deployments: 'Despliegues',
      noDeployment: 'Ninguno todavía',
      port: 'Puerto',
      inspector: 'Inspector',
      tags: 'Etiquetas',
      coDeployedWith: 'Desplegado junto a',
      stores: 'Stores que escribe',
      noStore: 'Ninguno',
      exposedAPIs: 'APIs que expone',
      dependantAPIs: 'APIs que consume',
      publishedEvents: 'Eventos que publica',
      subscriptions: 'Suscripciones',
      subscription: {
        event: 'Evento',
        mode: 'Modo',
        attempts: 'Intentos',
        dedupe: 'Deduplicación',
      },
      none: 'Ninguno',
      plane: 'Plano',
      planes: {
        control: 'Control',
        platform: 'Plataforma',
        tenant: 'Organización',
      },
      partitioning: 'Partición',
      partitionings: {
        single: 'Una base compartida',
        'per-organization': 'Una base por organización',
      },
      truth: 'Verdad',
      systemOfRecord: 'Registro original',
      projectionOf: 'Proyección de',
      writer: 'Único escritor',
      hosts: 'Dominios que aloja',
      noHosts: 'Ninguno: guarda registros que no son entidades',
      binding: 'Por qué comparten store',
      useCases: 'Casos de uso del dominio',
      package: 'Paquete',
      capability: 'Capacidad',
      store: 'Store',
      map: 'Mapa de stores por plano',
      mapDescription:
        'Los stores agrupados por plano, con el slice que escribe cada uno y la flecha de cada proyección.',
      mapLink: 'Ver el mapa',
    },
  },
};
