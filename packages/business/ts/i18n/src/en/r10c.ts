type EsR10c = typeof import('../es/r10c').r10c;

export const r10c: EsR10c = {
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
      // The window is named rather than left for the button to stop working on
      // its own: the receipt carries the moment the server stamped, and the two
      // agree because `RECEIPT_TTL_SECONDS` and the service's own dial are one
      // number (ADR 0058 §5).
      cancel: 'Cancel order',
      cancelWindow: 'You can cancel this order until {{time}}.',
      cancelPending: 'Cancelling…',
      cancelledHeading: 'Order cancelled',
      cancelled:
        'We have cancelled your order and the refund is on its way. It can take a few days to appear on your statement.',
      cancelFailed:
        'The order could not be cancelled. The window may have closed, or it may already be on its way.',
    },
    footer: {
      note: 'Demo catalog. No order is real.',
    },
  },
};
