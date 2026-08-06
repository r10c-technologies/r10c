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
