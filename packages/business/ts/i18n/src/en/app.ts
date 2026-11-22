type EsApp = typeof import('../es/app').app;

export const app: EsApp = {
  admin: {
    brand: 'r10c Admin',
    title: 'r10c · Marketplace admin',
    description: 'Back office for the r10c marketplace.',
    /** The two palettes the account menu offers (#530). */
    themes: {
      ocean: 'Ocean',
      midnight: 'Midnight',
    },
    home: {
      tiles: "Today's work",
      none: 'When you act for an organization, what needs your attention appears here.',
    },
    nav: {
      dashboard: 'Dashboard',
      account: 'Account',
    },
    menu: {
      trigger: 'Admin',
      preferences: 'Preferences',
      signOut: 'Sign out',
    },
    account: {
      title: 'Account',
      signedIn: 'Signed in',
      verified: 'Identity verified by marketplace-admin-service.',
      failed:
        'Could not verify your session with the backend. Try signing in again.',
      userId: 'User id:',
      subject: 'Subject:',
      session: 'Session:',
      roles: 'Roles:',
      none: '(none)',
      signingOut: 'Signing out…',
    },
    playground: 'Design System Playground',
  },
  auth: {
    brand: 'r10c Identity',
    title: 'r10c · Identity',
    description: 'Sign in to the r10c fleet.',
    signIn: {
      overline: 'Identity',
      title: 'Sign in',
      subtitle: 'Access the r10c marketplace fleet.',
      continue: 'Continue',
      hosted:
        'We will take you to r10c Identity to verify who you are. You can create an account, recover one, or use a second factor there.',
      errors: {
        providerUnavailable: 'We could not reach the identity provider.',
        invalidState: 'That sign-in link has expired. Please try again.',
        accountInactive: 'Your account is suspended.',
        accessDenied: 'You cancelled the sign-in.',
        invalidRequest: 'The provider’s response came back incomplete.',
        unexpected: 'Something went wrong signing you in.',
      },
    },
  },
  marketplace: {
    title: 'r10c · Marketplace',
    description: 'The r10c marketplace storefront.',
    overline: 'Storefront',
    heading: 'Marketplace',
    lead: "The same entifix design system as the admin app — driven by this app's own emerald brand palette. Switch light/dark below.",
    addToCart: 'Add to cart',
    buttons: {
      title: 'Buttons',
      subtitle: 'Same atoms, storefront brand.',
      primary: 'Primary',
      secondary: 'Secondary',
      ghost: 'Ghost',
      checkout: 'Checkout',
    },
    typography: {
      title: 'Typography',
      body: 'Body text scales fluidly with the viewport and follows the active palette.',
      caption: "Caption — brand colors come from this app's themes.css.",
    },
  },
  docs: {
    brand: 'r10c',
    title: 'r10c documentation',
    description:
      'What r10c does, who may do it and where each record lives, generated from the code.',
    languages: {
      title: 'Choose a language',
      es: 'Español',
      en: 'English',
    },
    home: {
      title: 'Home',
      description: 'Four doors into the same register, one per reader.',
      intro:
        'Every use case has exactly one page, generated from the capability register. Start from the door that is yours.',
      storybook: 'Storefront components (Storybook)',
      storybookNote:
        'The storefront components, each in its states, with its accessibility check.',
    },
    audiences: {
      title: 'Who it is for',
      developer: {
        title: 'Developers',
        description:
          'Every use case by domain, with the permissions it needs and the service crossings it takes.',
      },
      operator: {
        title: 'Platform operators',
        description:
          'Which role grants each permission, and which steps one service takes on behalf of another.',
      },
      merchant: {
        title: 'Merchants',
        description:
          'What a seller can do today, on which screen, and what does not exist yet.',
      },
      evaluator: {
        title: 'Evaluators',
        description:
          'What is built and what is planned, counted from the register rather than from a promise.',
      },
    },
    useCase: {
      id: 'Id',
      status: 'Status',
      domain: 'Domain',
      oda: 'ODA component',
      odaNone: 'No ODA analog',
      entities: 'Entities',
      subject: 'subject',
      permissions: 'Permissions',
      crossing: 'service crossing',
      crossings: 'Service crossings',
      roles: 'Roles that grant it',
      noRole: 'No role: a service or the buyer does it',
      screens: 'Screens',
      noScreen: 'No screen: another action invokes it',
      verticals: 'Verticals',
      allVerticals: 'All',
      notBuilt: 'Not in the code yet. The date is on the milestone, not here.',
      count: 'Use cases',
    },
    entityMap: {
      title: 'Entity map',
      description:
        'The entities this use case touches, with the parts each one owns and the records it points at.',
      from: 'From',
      member: 'Member',
      relation: 'Relation',
      to: 'To',
      store: 'Store',
      part: 'A part of its own',
      noStore: 'No store',
      noRelation:
        'Its metadata declares no composition, link or reference to another record.',
      kinds: {
        composition: 'Composition: written and read with its owner',
        link: 'Link',
        reference: 'Reference in the same store',
        id: 'Id in another store, never a link',
      },
      short: {
        composition: 'owns',
        link: 'link',
        reference: 'reference',
        id: 'id',
      },
    },
    statuses: {
      implemented: 'Built',
      planned: 'Planned',
      'in-design': 'In design',
    },
    verticals: {
      hardware: 'Hardware store',
      'phone-accessories': 'Phone accessories',
      'shoemaking-supplies': 'Shoemaking supplies',
    },
    catalog: {
      title: 'Services',
      description:
        'Each slice with what it deploys, the stores it writes and the APIs and events it exposes, derived from tools/slices.',
      storesTitle: 'Stores',
      storesDescription:
        'Each store with its plane, its partitioning and its single writer.',
      kind: 'Kind',
      kinds: {
        domain: 'Domain',
        system: 'System',
        component: 'Component',
        resource: 'Resource',
        api: 'API',
      },
      slice: 'Slice',
      status: 'Status',
      sliceStatuses: { active: 'Active', planned: 'Planned' },
      domains: 'Domains',
      noDomain: 'None: a platform slice',
      deployments: 'Deployments',
      noDeployment: 'None yet',
      port: 'Port',
      inspector: 'Inspector',
      tags: 'Tags',
      coDeployedWith: 'Co-deployed with',
      stores: 'Stores it writes',
      noStore: 'None',
      exposedAPIs: 'APIs it exposes',
      dependantAPIs: 'APIs it calls',
      publishedEvents: 'Events it publishes',
      subscriptions: 'Subscriptions',
      subscription: {
        event: 'Event',
        mode: 'Mode',
        attempts: 'Attempts',
        dedupe: 'Dedupe',
      },
      none: 'None',
      plane: 'Plane',
      planes: {
        control: 'Control',
        platform: 'Platform',
        tenant: 'Tenant',
      },
      partitioning: 'Partitioning',
      partitionings: {
        single: 'One shared database',
        'per-organization': 'One database per organization',
      },
      truth: 'Truth',
      systemOfRecord: 'System of record',
      projectionOf: 'Projection of',
      writer: 'Single writer',
      hosts: 'Domains it hosts',
      noHosts: 'None: it holds records that are not entities',
      binding: 'Why they share a store',
      useCases: 'Use cases in the domain',
      package: 'Package',
      capability: 'Capability',
      store: 'Store',
      map: 'Store map by plane',
      mapDescription:
        'The stores grouped by plane, with the slice that writes each one and an arrow for each projection.',
      mapLink: 'See the map',
    },
  },
};
