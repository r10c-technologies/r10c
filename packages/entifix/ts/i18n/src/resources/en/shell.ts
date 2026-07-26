type EsShell = typeof import('../es/shell').shell;

export const shell: EsShell = {
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
  workspace: {
    copyLink: 'Copy link',
    empty: 'No open tabs. Pick a catalog from the sidebar to start.',
    unsupported: "This tab can't be opened here.",
    discard: 'Discard unsaved changes in this tab?',
  },
};
