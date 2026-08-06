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
    nav: {
      // `//home`, where middleware lands an authenticated visitor. Not the
      // breadcrumb root — that is the shell's `shell:breadcrumbs.home`.
      dashboard: 'Panel',
      catalog: 'Catálogo',
      products: 'Productos',
      brands: 'Marcas',
      categories: 'Categorías',
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
    nav: {
      identity: 'Identidad',
      users: 'Usuarios',
      newUser: 'Nuevo usuario',
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
};
