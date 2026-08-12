type EsShell = typeof import('../es/shell').shell;

export const shell: EsShell = {
  auth: {
    nav: {
      identity: 'Identity',
      users: 'Users',
      newUser: 'New user',
      accountSection: 'Account',
    },
    account: {
      overline: 'Account',
      title: 'My account',
      subtitle: 'Your identity and your access to the r10c fleet.',
      menu: 'Account',
      identifiers: 'Identifiers',
      noIdentifiers: 'No identifiers on record.',
      userId: 'User ID',
      subject: 'Subject',
      session: 'Session',
      roles: 'Roles',
      none: 'None',
      failed: 'We could not load your account.',
    },
    sessions: {
      overline: 'Security',
      title: 'Active sessions',
      subtitle: 'Where you are signed in. End anything you do not recognise.',
      current: 'This device',
      unknownDevice: 'Unknown device',
      startedAt: 'Started',
      expiresAt: 'Expires',
      lastIp: 'IP',
      revoke: 'End',
      revoking: 'Ending…',
      revokeOthers: 'End all others',
      empty: 'No other active sessions.',
      failed: 'We could not load your sessions.',
      loading: 'Loading sessions…',
    },
    security: {
      overline: 'Security',
      title: 'Password and access',
      subtitle:
        'Your password, your second factor and your linked accounts live in r10c Identity.',
      explain:
        'r10c does not store your password. Manage it, along with two-step verification and social sign-in, at the identity provider.',
      manage: 'Manage at r10c Identity',
    },
    fields: {
      displayName: 'Display name',
      email: 'Email',
      username: 'Username',
      role: 'Role',
    },
    submit: {
      wait: 'Please wait…',
      creating: 'Creating…',
      createUser: 'Create user',
    },
    users: {
      title: 'Users',
      newTitle: 'New user',
      fallbackName: 'User',
      sessionsTitle: 'This user’s sessions',
      sessionsEmpty: 'This user has no active sessions.',
      sessionsFailed: 'We could not load this user’s sessions.',
      kick: 'End all their sessions',
      kicking: 'Ending…',
    },
  },
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
    security: 'Security',
    sessions: 'Sessions',
    signOut: 'Sign out',
  },
  workspace: {
    copyLink: 'Copy link',
    empty: 'No open tabs. Pick a catalog from the sidebar to start.',
    unsupported: "This tab can't be opened here.",
    discard: 'Discard unsaved changes in this tab?',
  },
  storefront: {
    nav: {
      catalog: 'Catalog',
    },
    home: {
      overline: 'Storefront',
      heading: 'r10c Marketplace',
      lead: 'Things for the house, chosen slowly.',
      featured: 'Featured',
    },
    category: {
      overline: 'Category',
      empty: 'Nothing in this category yet.',
      sort: 'Sort',
      sortByName: 'Name',
      sortByCode: 'Reference',
      results: '{{count}} products',
      previous: 'Previous',
      next: 'Next',
      pageOf: 'Page {{page}} of {{pages}}',
    },
    product: {
      addToCart: 'Add to cart',
      view: 'View product',
      brand: 'Brand',
      category: 'Category',
      reference: 'Reference',
      related: 'You might also like',
    },
    search: {
      heading: 'Search',
      label: 'Search products',
      placeholder: 'Lamp, mug, blanket…',
      submit: 'Search',
      resultsFor: 'Results for “{{term}}”',
      empty: 'Nothing matched “{{term}}”.',
      prompt: 'Type something to start searching.',
    },
    cart: {
      heading: 'Cart',
      empty: 'Your cart is empty.',
      remove: 'Remove',
      units: 'Qty {{count}}',
      total: 'Items in total',
      keepShopping: 'Keep shopping',
    },
    footer: {
      note: 'Demo catalog. No order is real.',
    },
  },
};
