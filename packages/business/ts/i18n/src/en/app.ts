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
    api: {
      title: 'APIs',
      description:
        'Every operation each service serves, from the OpenAPI document it answers at $openapi.',
      intro:
        'Each page is generated at build time from the same assembly the service serves, with no server running, so it cannot drift from the service. Read-only: there is no playground, because almost every route needs a session or a crossing token.',
      operations: 'operations',
      operation: 'Operation',
      slice: 'Slice',
      download: 'The OpenAPI document',
      downloadNote: 'the JSON this page is drawn from.',
      name: 'Parameter',
      in: 'In',
      required: 'Required',
      type: 'Type',
      yes: 'Yes',
      no: 'No',
      noParameters: 'No parameters.',
      requestBody: 'Request body',
      noBody: 'No request body.',
      noContent: 'no body',
      failures: 'Failures',
      none: 'None',
      problem: 'Problem body',
      problemNote:
        'Every failure answers application/problem+json in this shape. Its code is the key of the errors catalog, and a client decides by the code, never by the status.',
      link: 'Its API',
    },
    flows: {
      title: 'Flows',
      description:
        'Each flow a sale goes through, step by step, composed by the same code the coordinator runs.',
      intro:
        'A flow is a routing slip: the coordinator composes it once, from a recipe and the facts it verified, and runs its steps in order on a durable engine. These are the flows of the MVP, each for one vendor.',
      diagram: 'The steps in order, with each branch a wait can take',
      interactive: 'Explore the diagram',
      static: 'Back to the static diagram',
      legendTitle: 'How to read it',
      legend: {
        pivot:
          'Thick border: the pivot. Before it every step can be undone; after it the flow only moves forward.',
        wait: 'Dotted border: a wait for an answer from outside the flow.',
        compensatable:
          'Dashed border: a step that is undone if a later step before the pivot fails.',
        retriable:
          'Plain border: a step that is retried until it succeeds, after the pivot.',
      },
      kinds: {
        pivot: 'Pivot',
        wait: 'Wait',
        compensatable: 'Undone on failure',
        retriable: 'Retried until it succeeds',
      },
      columns: {
        order: 'No.',
        step: 'Step',
        kind: 'Kind',
        service: 'Service',
        call: 'Call',
        undo: 'Undone by',
        when: 'Only when',
      },
      coordinator: 'The coordinator itself',
      notUndone: 'Not undone',
      always: 'Always',
      answeredWith: 'answered',
      outcomes: {
        confirmed: 'the seller confirmed the payment',
        cancelled: 'the payment did not arrive',
        delivered: 'delivered',
        refused: 'refused',
        unanswered: 'no report in time',
      },
      scenarios: {
        'checkout-card': {
          title: 'Storefront checkout, paid by card',
          description:
            'The buyer pays at checkout: stock is held, the order written, the money taken, and then the shipment opened.',
        },
        'checkout-cash-on-delivery': {
          title: 'Storefront checkout, cash on delivery',
          description:
            'The buyer pays the courier: the seller must accept cash on delivery, and no money moves at checkout.',
        },
        'checkout-payment-link': {
          title: 'Storefront checkout, paid by link',
          description:
            'The buyer pays off the platform: the order waits for the seller to confirm the payment, and lets its stock go if it never arrives.',
        },
        'checkout-counter': {
          title: 'Sale at the counter',
          description:
            'The seller sells in person: the same checkout, with the goods handed over on the spot instead of shipped.',
        },
        delivery: {
          title: 'Delivery, cash on delivery',
          description:
            'The seller dispatches the parcel and the flow waits for the courier: delivered closes the order, refused waits for the return.',
        },
        cancellation: {
          title: 'Cancelling a paid order',
          description:
            'The order is locked against dispatch, the money given back, the goods put back in stock and the order closed.',
        },
      },
      steps: {
        flow: { commit: 'Commit point: nothing to charge now' },
        fulfilment: {
          'await-delivery': 'Wait for the courier’s report',
          'await-return': 'Wait for the parcel to come back',
          dispatch: 'Dispatch the parcel',
          hold: 'Hold the shipment',
          open: 'Open the shipment',
          withdraw: 'Withdraw the shipment',
        },
        order: {
          'await-payment': 'Wait for the payment',
          'claim-cancel': 'Claim the order for cancelling',
          close: 'Close the order',
          'close-cancelled': 'Close the order cancelled',
          'close-fulfilled': 'Close the order fulfilled',
          confirm: 'Confirm the order',
          'mark-dispatched': 'Mark the order handed over',
          'mark-shipped': 'Mark the order shipped',
          'notify-buyer': 'Mail the buyer the receipt',
          'open-group': 'Open the buyer’s receipt',
          'payment-decision': 'Wait for the seller’s decision',
          write: 'Write the seller’s order',
        },
        payment: {
          capture: 'Take the money',
          'cod-eligible': 'Check cash on delivery is allowed',
          'record-collection': 'Record the cash collected',
          'record-confirmation': 'Record the confirmed payment',
          refund: 'Give the money back',
        },
        stock: {
          convert: 'Turn the hold into a sale',
          release: 'Release the hold',
          reserve: 'Hold the stock',
          restore: 'Put the goods back in stock',
        },
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
