type EsR10c = typeof import('../es/r10c').r10c;

export const r10c: EsR10c = {
  /**
   * The mail to a storefront buyer: the receipt and the one-time access link
   * (ADR 0076 §6).
   */
  mail: {
    receipt: {
      subject: 'Your order {{number}}',
      greeting: 'Hello {{name}},',
      intro:
        'Thank you for your purchase. Here is a summary of your order {{number}}.',
      sellerOrder: 'Order {{number}} · {{tender}}',
      line: '{{quantity}} × {{name}} — {{amount}}',
      orderTotal: 'Total for this order: {{amount}}',
      ivaIncluded: 'VAT included: {{amount}}',
      billedTo: 'Billed to: {{name}} · {{idType}} {{taxId}}',
      billedToCf: 'Billed to: Final consumer (CF)',
      total: 'Total: {{amount}}',
      deliveryHeading: 'Delivery',
    },
    access: {
      subject: 'Your link to see order {{number}}',
      intro: 'You asked for a link to see your order {{number}} again.',
      link: 'Open your order on any device with this link. It works once and expires in {{hours}} hours:',
      action: 'Open my order',
      notYou:
        'If you did not ask for this email, you can ignore it: nobody else received the link.',
    },
    tender: {
      card: 'Card',
      cod: 'Cash on delivery',
      cash: 'Cash',
      link: 'Payment link',
    },
  },
  auth: {
    nav: {
      organization: 'My organization',
      identity: 'Identity',
      users: 'Users',
      accountSection: 'Account',
    },
    organization: {
      overline: 'Organization',
      title: 'Fiscal details',
      subtitle:
        'The tax ID, legal name, regime and establishment every order you sell is documented under.',
      failed: 'Your organization’s fiscal details could not be read.',
      saved: 'Fiscal details saved. New orders use them from now on.',
      paymentLink: {
        title: 'Payment links',
        hint: 'Buyers can choose to pay by a link you send them. You confirm each payment yourself; an unpaid order is cancelled when its window ends.',
        accepts: 'Take payment by a link I send',
        failed: 'Whether you take payment links could not be read.',
        saved: 'Saved. New checkouts follow it from now on.',
      },
      whatsapp: {
        title: 'WhatsApp',
        hint: 'The WhatsApp number your buyers may write to. Every receipt with your orders on it offers a chat with you. Leave it empty to offer none.',
        failed: 'Your WhatsApp number could not be read.',
        saved: 'Saved. Receipts offer the chat from now on.',
      },
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
      actionsFor: 'Actions for the session on {{device}}',
      othersCount_one: '(1 session)',
      othersCount_other: '({{count}} sessions)',
      empty: 'No other active sessions.',
      failed: 'We could not load your sessions.',
      loading: 'Loading sessions…',
    },
    organizations: {
      switchTitle: 'Switch organization',
      trigger: 'Organization: {{name}}',
      current: 'Current',
      switching: 'Switching…',
      close: 'Close',
      loading: 'Loading organizations…',
      failed: 'We could not load your organizations.',
      none: 'Your account does not belong to any organization.',
      unnamed: 'Unnamed organization',
      grantTitle: 'Who can grant me access?',
      grantMember:
        'Permissions are granted by the administrators of {{organization}}. Ask one of them for the access you need.',
      grantOperator:
        'Your account does not belong to any organization: permissions are granted by a platform operator.',
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
      email: 'Email',
    },
    users: {
      title: 'Users',
      newTitle: 'New user',
      fallbackName: 'User',
      sessionsTitle: 'This user’s sessions',
      sessionsEmpty: 'This user has no active sessions.',
      sessionsFailed: 'We could not load this user’s sessions.',
    },
  },
  storefront: {
    missing: {
      heading: 'We could not find that page',
      body: 'The product or category you are looking for does not exist, or is no longer available.',
      home: 'Back to the home page',
      search: 'Search the store',
    },
    nav: {
      skipToContent: 'Skip to content',
      catalog: 'Catalog',
    },
    breadcrumbs: {
      label: 'Breadcrumb',
      home: 'Home',
    },
    home: {
      overline: 'Storefront',
      heading: 'r10c Marketplace',
      promise: 'Products from many sellers, in one store',
      claims: {
        label: 'Why shop here',
        multiVendor: 'Buy from several sellers in a single order.',
        cancel:
          'You can cancel from your receipt until your order has shipped.',
      },
      categories: 'Categories',
      newest: 'New in',
      featured: 'Featured',
    },
    sampleStore: {
      note: 'Sample store · prices are illustrative, not a quote.',
    },
    seller: {
      overline: 'Store',
      empty: 'This seller has no products published yet.',
      share: 'Share on WhatsApp',
      shareText: 'Take a look at {{seller}}’s store: {{url}}',
      chat: 'Message the seller',
      chatText: 'Hi {{seller}}, I saw your store and have a question.',
      description: 'Shop the products of {{seller}}.',
    },
    category: {
      overline: 'Category',
      empty: 'Nothing in this category yet.',
      children: 'Subcategories',
    },
    // What a price buys, beside the price, when it is not one piece: a metre,
    // or a hundred screws (ADR 0082 §5).
    price: {
      per: 'per {{symbol}}',
      perQuantity: 'per {{quantity}} {{symbol}}',
      // A quantity with its unit: "3.5 m", "2 pcs".
      quantity: '{{quantity}} {{symbol}}',
      // How something not sold one at a time is sold.
      sold: 'From {{minimum}}, in steps of {{step}}',
      // What one presentation holds of its base (ADR 0082 §7): "Holds 100 m".
      contains: 'Holds {{quantity}}',
      // A price that steps down by quantity (ADR 0082 §8): the table on the
      // product page, and the note on a line that reached one.
      tiers: {
        heading: 'Volume prices',
        caption: 'The whole line is charged the price its quantity reaches.',
        quantity: 'Quantity',
        price: 'Price',
        from: 'From {{quantity}}',
        base: 'Less than {{quantity}}',
      },
      tierApplied: 'Volume price from {{quantity}}',
    },
    product: {
      variant: {
        label: 'Variants',
        unavailable: '{{value}}, sold out',
        axis: {
          color: 'Colour',
          size: 'Size',
          finish: 'Finish',
          capacity: 'Capacity',
        },
      },
      buy: 'Buy',
      kit: {
        chip: 'Kit',
        heading: 'Included in this kit',
        item: '{{quantity}} × {{name}}',
      },
      variantCount: 'Comes in {{count}} versions',
      soldBy: 'Sold by {{seller}}',
      delivery: {
        ships: 'Shipped by the seller',
        cod: 'Cash on delivery available',
        doesNotShip:
          'This seller does not ship, so this product cannot be bought online.',
        atTheDoor: 'What happens at the door',
        refuse:
          'You can refuse the parcel at the door; if you paid by card, you are refunded.',
        noReturns: 'There are no returns after delivery.',
      },
      details: 'Details',
      seller: 'Seller',
      addToCart: 'Add to cart',
      add: 'Add',
      addNamed: 'Add {{name}} to cart',
      brand: 'Brand',
      category: 'Category',
      reference: 'Reference',
      related: 'You might also like',
      available: 'Available',
      unavailable: 'Out of stock',
      gallery: 'Product images',
      galleryPrevious: 'Previous image',
      galleryNext: 'Next image',
      galleryPosition: '{{index}} of {{total}}',
    },
    catalog: {
      unavailable:
        'We could not load the catalog just now. It is not that nothing is for sale: try again in a moment.',
      retry: 'Try again',
    },
    listing: {
      // i18next picks the form from `count` by the locale's plural rules.
      results_one: '{{count}} product',
      results_other: '{{count}} products',
      empty: 'No product matches these filters.',
      filters: 'Filter',
      filtersSummary_zero: 'Filter',
      filtersSummary_one: 'Filter (1)',
      filtersSummary_other: 'Filter ({{count}})',
      sort: 'Sort',
      sorts: {
        relevance: 'Most relevant',
        priceAsc: 'Price: low to high',
        priceDesc: 'Price: high to low',
        newest: 'Newest',
        name: 'Name',
      },
      facets: {
        category: 'Category',
        brand: 'Brand',
        seller: 'Seller',
        price: 'Price',
        available: 'In stock only',
        min: 'From',
        max: 'To',
        apply: 'Apply',
      },
      myPhone: {
        label: 'My phone',
        choose: 'Choose your model',
        apply: 'Show what fits',
        showing: 'Showing what fits your {{model}}.',
        forget: 'Clear',
      },
    },
    search: {
      heading: 'Search',
      label: 'Search products',
      placeholder: 'Lamp, mug, blanket…',
      submit: 'Search',
      resultsFor: 'Results for “{{term}}”',
      empty: 'Nothing matched “{{term}}”.',
    },
    cart: {
      view: 'View cart',
      // Not `count_one`/`count_other`: the number is only known in the browser,
      // so the server translates around a mark, and `count` would pick a form.
      itemsOne: '{{items}} item',
      itemsOther: '{{items}} items',
      heading: 'Cart',
      empty: 'Your cart is empty.',
      remove: 'Remove',
      removeNamed: 'Remove {{name}} from the cart',
      added: '{{name}} was added to the cart.',
      removed: '{{name}} was removed from the cart.',
      undo: 'Undo',
      quantity: 'Quantity',
      quantityOf: 'Quantity of {{name}}',
      // A quantity refused, never rounded (ADR 0082 §3): the reason is the
      // `errors` catalog's.
      refused: '{{name}} was not changed in the cart.',
      blocked: 'Change the quantities marked to review the order.',
      update: 'Update',
      total: 'Total',
      keepShopping: 'Keep shopping',
      review: 'Review order',
    },
    review: {
      changed:
        'Something changed since you reviewed this order: a price, or an item that is no longer on sale. Check it again before placing it.',
      unavailable:
        'Some items in your cart are no longer on sale and are not part of this order.',
      heading: 'Review your order',
      intro:
        "Check each seller's items and how you pay them. Nothing is ordered or charged until you place the order.",
      subtotal: 'Subtotal',
      // How the buyer pays each seller (ADR 0076 §7): nothing chosen in
      // advance, and stated as a fact when the seller takes one tender.
      payment: {
        legend: 'How you pay {{seller}}',
        card: 'Card',
        cod: 'Cash on delivery',
        codHint: 'You pay in cash when the parcel arrives.',
        simulated:
          'Simulated payment: no card details are asked for and nothing is charged.',
        onlyCard:
          'You pay by card. Simulated payment: no card details are asked for and nothing is charged.',
        onlyCod: 'You pay in cash when the parcel arrives.',
        link: 'Payment link',
        linkHint:
          'The seller sends you a payment link. Your order waits for 48 hours until they confirm your payment.',
        required: 'Choose how you pay this seller.',
      },
      edit: 'Edit cart',
      place: 'Place order',
      tax: {
        legend: 'Invoicing',
        intro:
          'If you need an invoice under your tax ID, choose it here. Otherwise it is issued to consumidor final.',
        idTypes: {
          cf: 'Consumidor final (CF)',
          nit: 'NIT',
          cui: 'CUI (DPI)',
        },
        hints: {
          taxId:
            'No dashes needed. A NIT ends in its check digit, which may be K.',
        },
      },
      delivery: {
        legend: 'Delivery and contact',
        intro:
          'We use this to deliver your order and tell you how it is going. Only the sellers who ship it see it, and we delete it once it is no longer needed.',
        optional: '(optional)',
        chooseMunicipio: 'Choose your municipio',
        fields: {
          name: 'Name of who receives it',
          phone: 'Phone',
          email: 'Email',
          municipio: 'Municipio',
          zona: 'Zona',
          addressLine: 'Address',
          reference: 'Landmark',
          taxIdType: 'Invoice to',
          taxId: 'NIT or CUI',
          taxName: 'Name on the invoice',
        },
        hints: {
          phone: 'Eight digits. The courier calls you on this number.',
          email: 'We send your receipt and how to get back to your order.',
          reference: 'For example: across from the park, black gate.',
        },
      },
    },
    checkout: {
      empty: 'Nothing here is still on sale.',
      failed: 'Checkout could not be started. Please try again.',
      quantity:
        'A quantity in your cart is no longer sold that way. Change it to continue.',
      doesNotShip:
        '{{seller}} does not ship, so it cannot be bought from in the store. Remove its products from the cart to continue.',
      thisSeller: 'One of the sellers',
      // A tender per seller (ADR 0070). Cash on delivery is offered only where
      // the seller ships it.
      method: {
        card: 'Card',
        cod: 'Cash on delivery',
        link: 'Payment link',
      },
    },
    order: {
      ivaIncluded: 'VAT included:',
      fiscal: {
        pending: 'Electronic invoice being certified.',
        certified:
          'Electronic invoice {{type}} series {{series}} number {{number}}. Authorization {{authorization}}.',
        voided:
          'Electronic invoice {{type}} series {{series}} number {{number}}, voided. Authorization {{authorization}}.',
      },
      billedTo: 'Billed to: {{name}} · {{idType}} {{taxId}}',
      billedToCf: 'Billed to: Final consumer (CF)',
      statusHeading: 'Placing your order',
      pending:
        'We are confirming your order with each seller. This page updates on its own.',
      failed:
        'Your order could not be placed, and nothing was charged. Your cart is still here.',
      retry: 'Try again',
      checkNow: 'See if it is ready',
      checkNowHint:
        'Your browser does not update this page on its own. Use the button to see whether your order is placed.',
      heading: 'Thank you for your purchase',
      placed: 'Your order is placed, and the vendor has been notified.',
      reference: 'Order number',
      vendorNumber: 'Order {{number}}',
      receiptUntil: 'You can come back to this receipt until {{date}}.',
      // A payment-link order (ADR 0081): it waits for the seller to confirm
      // the payment, and the buyer pays by the link the seller sets.
      payment: {
        awaiting: 'Waiting for payment',
        until: 'The seller holds this order for you until {{time}}.',
        noLink:
          'The seller will send you a payment link. It will also appear here.',
        pay: 'Pay with {{provider}}',
        unlisted:
          'This link is the seller’s own, and opens {{host}}. Pay only if you recognise it.',
        expired:
          'This order expired before the seller confirmed a payment. If you paid, ask the seller for your money back.',
        // The receipt a buyer attaches (ADR 0081 §6).
        evidence: {
          title: 'Payment receipt',
          hint: 'Upload the screenshot or PDF your bank or the link provider gave you: a photo (JPEG, PNG or WebP) or a PDF of up to 5 MB.',
          file: 'Receipt file',
          submit: 'Attach receipt',
          attachedOne: 'Receipt {{n}} ({{kind}})',
          view: 'View',
          image: 'image',
          pdf: 'PDF',
          attached:
            'You attached the receipt. The seller will check it and confirm your payment.',
          failed: 'We could not attach the receipt. Try again.',
        },
      },
      delivery: {
        heading: 'Delivery',
        phone: 'Phone: •••• {{ending}}',
        zona: 'Zone {{zona}}',
      },
      units: 'Qty {{quantity}}',
      total: 'Total',
      unavailable:
        'We could not load your order just now. Your purchase is recorded under the number above; try again in a moment.',
      keepShopping: 'Keep shopping',
      expiredHeading: 'There is no order to show',
      expired:
        'The receipt for your last purchase is no longer available in this browser. If you have just bought something, check your confirmation email.',
      // The window is named rather than left for the button to stop working on
      // its own: the receipt carries the moment the server stamped, and the
      // button goes when that moment passes, while the receipt stays readable
      // until its own `receiptEndsAt` (ADR 0076 §6).
      cancel: 'Cancel order',
      cancelTitle: 'Cancel the order from {{seller}}?',
      cancelMessage:
        'This order will be cancelled and its total refunded to you. Orders from other sellers in this purchase do not change.',
      cancelConfirm: 'Cancel order and refund',
      cancelKeep: 'Keep the order',
      cancelledTag: 'Cancelled',
      whatsapp: {
        label: 'Message the seller on WhatsApp',
        text: {
          placed: 'Hi, I am writing about my order {{number}}.',
          awaitingPayment:
            'Hi, I am writing about paying for my order {{number}}.',
          dispatched:
            'Hi, I am writing about the shipment of my order {{number}}.',
          delivered:
            'Hi, I received my order {{number}} and I am writing about it.',
        },
      },
      tracker: {
        heading: 'Tracking',
        placed: 'Order received',
        payment: {
          card: 'Card payment',
          link: 'Payment by link',
        },
        dispatched: 'Dispatched',
        delivered: 'Delivered',
        state: {
          done: 'done',
          current: 'in progress',
          todo: 'pending',
        },
        codNote: 'You pay when it arrives.',
        guide: '{{courier}}, tracking number {{number}}',
        follow: 'Track the parcel',
      },
      cancelledAll: 'Every order in this purchase was cancelled.',
      cancelWindow: 'You can cancel this order until {{time}}.',
      cancelledHeading: 'Order cancelled',
      cancelled:
        'We have cancelled your order and the refund is on its way. It can take a few days to appear on your statement.',
      cancelling: 'Cancelling this order…',
      cancelPaymentPending:
        'Your payment is still being confirmed, so the order cannot be cancelled yet. Try again in a moment.',
      cancelFailed:
        'The order could not be cancelled. The window may have closed, or it may already be on its way.',
      findLink: 'Find my order',
      movedHeading: 'This order was opened on another device',
      moved:
        'Someone opened this order with the link from your email, so this browser can no longer show it. If that was you, carry on there; if not, ask for a new link.',
      find: {
        heading: 'Find my order',
        intro:
          'Enter your order number (the purchase’s or a seller’s) and the email you bought with. If they match, we will email you a link to open it.',
        number: 'Order number',
        email: 'Email',
        submit: 'Email me a link',
        sent: 'If the details match an order, we sent a link to that email. It may take a few minutes.',
      },
      access: {
        heading: 'Open your order',
        intro:
          'This link opens your order in this browser. It works once, and the browser you opened it in before will stop showing it.',
        open: 'Open my order',
        failed:
          'This link was already used or has expired. You can ask for a new one with your order number and your email.',
        missing:
          'This link is incomplete. You can ask for a new one with your order number and your email.',
      },
    },
    footer: {
      note: 'Demo catalog. No order is real.',
      findOrder: 'Find my order',
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
    item: {
      outOfStock: 'Nothing available to sell',
    },
    home: {
      outOfStock: 'Out of stock',
    },
  },
  order: {
    nav: {
      orders: 'Orders',
      received: 'Received orders',
    },
    home: {
      latest: 'Latest orders',
      none: 'No orders yet.',
    },
    list: {
      itemsMore_one: '{{name}} and 1 more',
      itemsMore_other: '{{name}} and {{count}} more',
    },
    // A payment-link order's region (ADR 0081): the seller sets the link the
    // buyer pays by, and confirms the payment with its authorization number.
    payment: {
      heading: 'Payment link',
      due: 'Waiting for payment until {{time}}. After that the order is cancelled and its stock goes back on sale.',
      linkSet: 'Link set ({{provider}}): {{url}}',
      confirmed: 'Paid. Authorization {{reference}}, confirmed {{time}}.',
      provider: 'Link provider',
      providerName: 'Provider name (optional)',
      url: 'Payment link (https)',
      setLink: 'Set payment link',
      reference: 'Authorization number',
      confirm: 'Confirm payment',
      // The payment receipts attached (ADR 0081 §6).
      evidence: 'Payment receipts',
      evidenceOne: 'Receipt {{n}}, attached by {{by}} on {{time}}',
      attachedBy: { buyer: 'the buyer', vendor: 'your team' },
      evidenceFile: 'Receipt you were sent (photo or PDF, up to 5 MB)',
      attachEvidence: 'Attach receipt',
    },
  },
  fulfilment: {
    nav: {
      title: 'Dispatch',
      shipments: 'Shipments',
    },
    home: {
      awaitingDispatch: 'Shipments to dispatch',
    },
    list: {
      line: '{{quantity}} × {{name}}',
    },
    whatsapp: {
      heading: 'Buyer',
      label: 'Message the buyer on WhatsApp',
      text: {
        preparing: 'Hi, about your order {{number}}: we are preparing it.',
        dispatched:
          'Hi, your order {{number}} is on its way. Your tracking number is {{tracking}}.',
        delivered: 'Hi, did your order {{number}} arrive well?',
      },
    },
    guide: {
      heading: 'Tracking',
      missing:
        'This shipment has no tracking number yet. Record it before dispatching: the buyer follows the parcel by it.',
      recorded: '{{courier}}, tracking number {{number}}',
      follow: 'Track the parcel',
      courier: 'Courier',
      courierName: 'Courier name',
      trackingUrl: 'Tracking link (optional)',
      number: 'Tracking number',
      record: 'Record tracking number',
    },
  },
  settlement: {
    nav: {
      settlement: 'Settlement',
      agreements: 'Agreements',
      agreements_vendor: 'My agreement',
      entries: 'Commission entries',
      entries_vendor: 'My commissions',
      runs: 'Settlement runs',
      payouts: 'Vendor payouts',
      payouts_vendor: 'My payouts',
    },
    home: {
      balance: 'Your next payout',
    },
    agreement: {
      channelRatesHint:
        'Leave blank to charge the default commission on that channel. A 0 means nothing is charged.',
      channelRateDefault: 'Default',
      noChannelRates: 'No per-channel rates',
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
      search: 'Search or scan a product',
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
      removeLineNamed: 'Remove {{name}}',
      tender: {
        cash: 'Cash',
        card: 'Card',
        voucher: 'Voucher',
        transfer: 'Transfer',
      },
      quantity: 'Quantity',
      offering: 'Product',
      total: 'Total',
      paymentMethod: 'Payment method',
      tax: {
        idType: 'Bill to',
        idTypes: { cf: 'Final consumer (CF)', nit: 'NIT', cui: 'CUI' },
        taxId: 'NIT or CUI number',
        name: 'Name on the invoice',
        billedTo: 'Billed to',
      },
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
      deviceModels: 'Phone models',
      categories: 'Categories',
      offerings: 'Product offerings',
      offeringPrices: 'Offering prices',
      catalogImports: 'Catalog imports',
      guided: 'Catalog',
    },
    /**
     * An offering's page gathers what used to be three screens (#564): each
     * region reads and writes through its own service.
     */
    offering: {
      // Beside the price on the offering list, when it is not for one unit:
      // the unit column says which (ADR 0082 §5).
      pricePer: 'per {{quantity}}',
      saleUnit: {
        resets:
          'The step and the minimum go back to one whole unit of the new unit. Once the offering is published, its unit no longer changes.',
      },
      variants: {
        alone: 'No other variant of this product is in your catalog yet.',
      },
      variant: {
        hint: 'A product’s variants are offerings with their own price and stock: choose what sets this one apart —colour, size, finish or capacity— and its value. Every variant of the product uses the same attributes.',
        none: 'This offering is no variant of its product.',
        add: 'Add an attribute',
        remove: 'Remove attribute {{position}}',
      },
      kit: {
        hint: 'A kit sells several of your products together at one price. Each kit sold takes every product in it from that product’s own stock.',
        loading: 'Loading your offerings…',
        pick: 'Choose a product',
        unavailable: '{{name}} (can no longer be in a kit)',
        add: 'Add a product',
        remove: 'Remove product {{position}}',
        notCounted:
          'A kit is sold by the unit. Set this offering’s unit to pieces first.',
      },
      stockSource: {
        hint: "A box, a roll or a dozen is sold from another offering's stock: each one sold takes this much from it, so the box and the loose units share one balance.",
        loading: 'Loading your offerings…',
        none: 'None: it holds its own stock',
        factor: 'Each one takes',
        notCounted:
          'A presentation is sold by the unit. Set this offering’s unit to pieces first.',
      },
      regions: {
        images: 'Images',
        prices: 'Prices',
        variants: 'Other variants',
        stock: 'Stock',
        movements: 'Stock movements',
      },
      images: {
        none: 'This specification has no images yet.',
        edit: 'Edit specification',
        shared:
          'The images belong to the specification: changing them changes every other offering that uses it too.',
        previous: 'Previous image',
        next: 'Next image',
        position: '{{index}} of {{total}}',
      },
    },
    // Where a price steps down by quantity (ADR 0082 §8): the form
    // `set-price-tiers` opens.
    price: {
      tiers: {
        hint: 'From each quantity on, the whole line costs the price you set here for the same quantity the base price is for. Each tier starts higher and costs less than the one before.',
        none: 'No volume prices: every quantity is charged the base price.',
        loading: 'Loading the product…',
        row: 'Tier {{position}}',
        remove: 'Remove tier {{position}}',
        add: 'Add a tier',
      },
    },
    /** A specification's page: its offerings, and how to offer it. */
    product: {
      regions: {
        offerings: 'Offerings of this product',
      },
    },
    wizard: {
      catalogImport: {
        title: 'Import catalog',
        steps: {
          mode: 'Mode',
          file: 'File',
          preview: 'Review',
        },
        mode: {
          question: 'How should the imported products be left?',
          draft: 'As drafts',
          draftHint:
            'They stay in design and unpublished, to be reviewed before they go on sale.',
          publish: 'Published',
          publishHint:
            'Each product is released and its offering goes on sale in the store as soon as it is imported.',
        },
        file: {
          prompt:
            'Choose a CSV or Excel sheet with one product per row. The first row holds the template’s headers.',
          label: 'Catalog sheet',
          template: 'Download the template',
          reading: 'Reading the sheet…',
          read: '{{file}}: {{ready}} rows ready, {{rejected}} with problems.',
          unreadable:
            'This file could not be read. Save it as CSV or as Excel (.xlsx).',
          required:
            'Choose a sheet with at least one product that can be imported.',
        },
        preview: {
          prompt: 'Review what will be imported before confirming.',
          coded:
            'Rows with a SKU: {{count}}. A row with the SKU of a product you already have updates its name, price and the way it is sold; a new one creates the product.',
          ready: 'Rows to import: {{count}}',
          rejected: 'Rows that will not be imported: {{count}}',
          mode: 'Mode: {{mode}}',
          row: 'Row',
          column: 'Column',
          reason: 'Reason',
          failed: 'The import did not complete.',
        },
      },
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
        fits: {
          universal: 'Universal: fits any phone',
          universalShort: 'Universal',
          universalHint:
            'Choose this for chargers, cables and stands. It is not combined with models.',
        },
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
};
