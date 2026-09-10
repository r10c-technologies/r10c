type EsShell = typeof import('../es/shell').shell;

export const shell: EsShell = {
  auth: {
    nav: {
      identity: 'Identity',
      users: 'Users',
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
  /**
   * The stock surface — the first Operaciones screens in the back office.
   *
   * The *tier* name ("Operaciones") comes from `nav.screenType.operation`; this
   * names the group inside it.
   */
  stock: {
    nav: {
      stock: 'Stock',
      items: 'Stock on hand',
      movements: 'Movement ledger',
      reservations: 'Reservations',
    },
  },
  order: {
    nav: {
      orders: 'Orders',
    },
  },
  sales: {
    nav: {
      sales: 'Sales',
      channels: 'Sales channels',
      guided: 'Sales',
      counterSale: 'Sell at the counter',
    },
    counterSale: {
      title: 'Counter sale',
      steps: {
        channel: 'Channel',
        lines: 'Products',
        payment: 'Payment',
        summary: 'Summary',
      },
      channelHint: 'Pick the channel this sale goes through.',
      linesHint: 'Add the published products you are selling.',
      addLine: 'Add product',
      removeLine: 'Remove',
      quantity: 'Quantity',
      offering: 'Product',
      total: 'Total',
      paymentMethod: 'Payment method',
      charge: 'Charge',
      sold: 'Sale recorded',
      soldDetail: 'The stock is already drawn down and the order is written.',
      newSale: 'New sale',
      emptyLines: 'Add at least one product to charge for.',
    },
  },
  marketplaceAdmin: {
    nav: {
      catalog: 'Catalog',
      products: 'Products',
      brands: 'Brands',
      categories: 'Categories',
      offerings: 'Product offerings',
      offeringPrices: 'Offering prices',
      guided: 'Catalog',
    },
    wizard: {
      productSetup: {
        title: 'New product',
        launch: 'Guided new product',
        steps: {
          start: 'Source',
          source: 'Base product',
          identity: 'Identification',
          classification: 'Classification',
          summary: 'Summary',
        },
        start: {
          question: 'How do you want to start?',
          blank: 'From scratch',
          blankHint: 'Enter the details by hand.',
          duplicate: 'Duplicate an existing one',
          duplicateHint:
            'Start from a product already on file. The code is not copied: it identifies the original.',
        },
        source: {
          prompt: 'Pick the product to start from.',
          chosen: 'Base product: {{name}}',
          required: 'Pick a product to continue.',
        },
        summary: {
          prompt: 'Check what you entered before creating it.',
          origin: 'Source',
          originBlank: 'From scratch',
          originDuplicate: 'Duplicated from {{name}}',
          empty: 'Not set',
        },
        recap: 'You had already answered:',
      },
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
    openInNewTab: 'Open {{label}} in a new tab',
    openInNewTabShort: 'Open in a new tab',
    /**
     * The screen taxonomy (ADR 0033). Translated like every other string rather
     * than kept in Spanish: what that decision fixed was which *Spanish* word
     * ships to the default locale, not that the term is untranslatable.
     */
    screenType: {
      master: 'Definitions',
      operation: 'Operations',
      wizard: 'Wizards',
      report: 'Reports',
    },
  },
  commandPalette: {
    open: 'Search or run',
    title: 'Search or run',
    placeholder: 'Search a record, a screen or a command…',
    newPlaceholder: 'What would you like to create?',
    newLabel: 'New…',
    newTitle: 'New',
    back: 'Back',
    empty: 'No results',
    loading: 'Searching…',
    more_one: '{{count}} more',
    more_other: '{{count}} more',
    typeMore: 'Type at least {{count}} characters to search records.',
    groups: {
      actions: 'Actions',
      commands: 'Commands',
      navigation: 'Navigation',
      tabs: 'Open tabs',
      records: 'Records',
    },
    unavailableScope: 'Not available here: {{reason}}',
    unavailableReach: 'We could not reach this source: {{reason}}',
    openInWorkspaceHint: 'Tab',
  },
  sidebar: {
    expand: 'Expand sidebar',
    collapse: 'Collapse sidebar',
    openMenu: 'Open the menu',
    closeMenu: 'Close the menu',
    menu: 'Navigation menu',
    expandGroup: 'Expand {{group}}',
    collapseGroup: 'Collapse {{group}}',
  },
  breadcrumbs: {
    home: 'Home',
    // The `/new` segment, which every domain's create route shares. It was
    // an auth-specific string until one host started serving two domains,
    // at which point a catalog page's breadcrumb read "New user".
    new: 'New',
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
    discardTitle: 'Discard changes',
    discard: 'This tab has unsaved changes. Closing it will lose them.',
    discardConfirm: 'Discard',
    // See the Spanish catalog for why a failure's reason is not a key here.
    pendingLabel: 'Save status',
    savePending_one: 'Saving 1 record…',
    savePending_other: 'Saving {{count}} records…',
    saveFailed: 'The record could not be saved.',
    saveFailedDismiss: 'Dismiss',
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
      available: 'Available',
      unavailable: 'Out of stock',
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
      checkout: 'Check out',
    },
    checkout: {
      placed: 'Your order is placed. The vendor has been notified.',
      unavailable:
        'One of these is no longer available in the quantity you asked for. Nothing was charged, and every hold has been released.',
      empty: 'Nothing here is still on sale.',
      failed: 'Checkout could not be completed. Please try again.',
    },
    order: {
      heading: 'Thank you for your purchase',
      placed: 'Your order is placed, and the vendor has been notified.',
      reference: 'Order number',
      units: 'Qty {{count}}',
      total: 'Total',
      tooManyLines:
        'This order has {{count}} items, too many to list here. The order number above identifies all of them.',
      keepShopping: 'Keep shopping',
      expiredHeading: 'There is no order to show',
      expired:
        'The receipt for your last purchase is no longer available in this browser. If you have just bought something, check your confirmation email.',
    },
    footer: {
      note: 'Demo catalog. No order is real.',
    },
  },
};
