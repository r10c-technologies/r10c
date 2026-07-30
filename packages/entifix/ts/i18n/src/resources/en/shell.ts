type EsShell = typeof import('../es/shell').shell;

export const shell: EsShell = {
  systemManagement: {
    nav: {
      section: 'System',
      configuration: 'Configuration',
    },
    configuration: {
      title: 'Platform configuration',
      description:
        'Parameters every service resolves at boot. Editing a value affects that service on its next start.',
      secretPlaceholder: '•••••• (unchanged)',
      secretHint:
        'Leaving this blank keeps the stored value. Typing a new one replaces it.',
    },
  },
  nav: {
    primary: 'Primary',
    openInWorkspace: 'Open {{label}} in workspace',
    openInWorkspaceShort: 'Open in workspace',
  },
  sidebar: {
    expand: 'Expand sidebar',
    collapse: 'Collapse sidebar',
  },
  breadcrumbs: {
    home: 'Home',
  },
  account: {
    profile: 'Profile',
    password: 'Password',
    sessions: 'Sessions',
    signOut: 'Sign out',
  },
  workspace: {
    copyLink: 'Copy link',
    empty: 'No open tabs. Pick a catalog from the sidebar to start.',
    unsupported: "This tab can't be opened here.",
    discard: 'Discard unsaved changes in this tab?',
  },
};
