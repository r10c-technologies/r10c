/** Copy owned by the Next shells — back-office chrome and the tab workspace. */
export const shell = {
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
    password: 'Contraseña',
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
};
