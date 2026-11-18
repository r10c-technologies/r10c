type EsEntity = typeof import('../es/entity').entity;

export const entity: EsEntity = {
  configuration: {
    form: {
      editTitle: 'Edit parameter',
      newTitle: 'New parameter',
    },
    label: 'Parameter',
    plural: 'Configuration',
    fields: {
      id: 'ID',
      service: 'Service',
      groupName: 'Group',
      key: 'Key',
      value: 'Value',
      isSecret: 'Secret',
      updatedAt: 'Updated at',
      updatedBy: 'Updated by',
    },
  },
  'product-specification': {
    form: {
      brandEmbedded: 'Brand (embedded)',
      categoryForeign: 'Category (foreign key)',
      editTitle: 'Edit product',
      newTitle: 'New product',
    },
    label: 'Product',
    plural: 'Products',
    fields: {
      id: 'ID',
      code: 'Code',
      name: 'Name',
      description: 'Description',
      brand: 'Brand',
      category: 'Category',
      media: 'Images',
      fitsDeviceModelIds: 'Compatible phones',
    },
  },
  'media-reference': {
    fields: {
      url: 'Image URL',
      alt: 'Image description',
    },
  },
  'reference-status': {
    active: 'Active',
    retired: 'Retired',
  },
  'device-model': {
    form: {
      editTitle: 'Edit phone model',
      newTitle: 'New phone model',
    },
    label: 'Phone model',
    plural: 'Phone models',
    fields: {
      id: 'ID',
      code: 'Code',
      name: 'Name',
      maker: 'Maker',
      status: 'Status',
    },
    useCases: {
      restore: 'Restore',
      retire: 'Retire',
      retireConfirm:
        'These models will no longer be offered when classifying products. Offerings already published with them do not change.',
    },
  },
  'product-brand': {
    form: {
      editTitle: 'Edit brand',
      newTitle: 'New brand',
    },
    label: 'Brand',
    plural: 'Brands',
    fields: {
      id: 'ID',
      code: 'Code',
      name: 'Name',
      description: 'Description',
      website: 'Website',
      status: 'Status',
    },
    useCases: {
      restore: 'Restore',
      retire: 'Retire',
      retireConfirm:
        'These brands will stop being offered when classifying products. Offerings already published under them are unchanged.',
    },
  },
  'product-category': {
    form: {
      editTitle: 'Edit category',
      newTitle: 'New category',
    },
    label: 'Category',
    plural: 'Categories',
    fields: {
      id: 'ID',
      code: 'Code',
      name: 'Name',
      description: 'Description',
      status: 'Status',
      parentId: 'Parent category',
    },
    useCases: {
      restore: 'Restore',
      retire: 'Retire',
      retireConfirm:
        'These categories will stop being offered when classifying products and will leave the browse tree. Offerings already published under them are unchanged.',
    },
  },
  'user-identity': {
    label: 'User',
    plural: 'Users',
    useCases: {
      revokeSessions: 'End all sessions',
      revokeSessionsConfirm:
        'Every session this user holds will be ended on all their devices. They will be notified by email.',
      updateAspects: 'Change role and status',
      signOutOthers: 'Sign out my other sessions',
      signOutOthersKeywords: 'logout, revoke, devices, cerrar sesion',
      signOutOthersConfirm:
        'Every session you have on other devices and browsers will end. This one stays open.',
      switchOrganization: 'Switch organization',
      switchOrganizationKeywords:
        'organization, switch, cambiar, organizacion, company',
    },
    fields: {
      id: 'ID',
      displayName: 'Display name',
      status: 'Status',
      role: 'Role',
      identifiers: 'Identifiers',
    },
    values: {
      role: {
        user: 'User',
        admin: 'Admin',
        'super-admin': 'Super admin',
      },
      status: {
        active: 'Active',
        suspended: 'Suspended',
        disabled: 'Disabled',
      },
    },
  },
  'entity-identifier': {
    label: 'Identifier',
    plural: 'Identifiers',
    fields: {
      id: 'ID',
      userId: 'User ID',
      type: 'Type',
      value: 'Value',
      provider: 'Provider',
      verified: 'Verified',
    },
    values: {
      type: {
        email: 'Email',
        username: 'Username',
        phone: 'Phone',
        oauth: 'OAuth',
        'external-subject': 'External subject',
      },
    },
  },
  'user-device': {
    label: 'Device',
    plural: 'Devices',
    useCases: {
      signOutSession: 'Sign out this session',
      signOutSessionConfirm:
        'The session on this device ends, and whoever uses it has to sign in again. If it is this one, you are signed out now.',
    },
    fields: {
      id: 'ID',
      userId: 'User ID',
      deviceId: 'Device ID',
      browser: 'Browser',
      os: 'Operating system',
      type: 'Type',
      lastIp: 'Last IP',
      firstSeenAt: 'First seen',
      lastSeenAt: 'Last seen',
    },
  },
  organization: {
    label: 'Organization',
    plural: 'Organizations',
    fields: {
      id: 'ID',
      name: 'Name',
      slug: 'Slug',
      status: 'Status',
      updatedAt: 'Last updated',
    },
    values: {
      status: {
        active: 'Active',
        suspended: 'Suspended',
        archived: 'Archived',
      },
    },
  },
  individual: {
    label: 'Person',
    plural: 'People',
    fields: {
      id: 'ID',
      fullName: 'Full name',
      userId: 'User ID',
    },
  },
  'party-role': {
    label: 'Party role',
    plural: 'Party roles',
    fields: {
      id: 'ID',
      partyId: 'Party ID',
      role: 'Role',
      organizationId: 'Organization ID',
    },
    values: {
      role: {
        customer: 'Customer',
        vendor: 'Vendor',
        operator: 'Operator',
      },
    },
  },
  membership: {
    label: 'Membership',
    plural: 'Memberships',
    fields: {
      id: 'ID',
      partyId: 'Party ID',
      organizationId: 'Organization ID',
      roleIds: 'Roles',
      isDefault: 'Default',
    },
  },
  role: {
    label: 'Role',
    plural: 'Roles',
    fields: {
      id: 'ID',
      organizationId: 'Organization ID',
      name: 'Name',
      permissions: 'Permissions',
    },
  },
  entitlement: {
    label: 'Entitlement',
    plural: 'Entitlements',
    fields: {
      id: 'ID',
      organizationId: 'Organization ID',
      domains: 'Modules',
    },
  },
  'dictionary-term': {
    label: 'Dictionary term',
    plural: 'Dictionary terms',
    fields: {
      id: 'ID',
      code: 'Code',
      values: 'Values',
      unit: 'Unit',
    },
  },
  'published-vendor': {
    label: 'Published vendor',
    plural: 'Published vendors',
    fields: {
      id: 'ID',
      vendorId: 'Vendor ID',
      displayName: 'Seller',
      announcedAt: 'Announced at',
      acceptsCod: 'Accepts cash on delivery',
      holdsStock: 'Holds stock',
    },
  },
  'published-offering': {
    label: 'Published offering',
    plural: 'Published offerings',
    fields: {
      id: 'ID',
      offeringId: 'Offering ID',
      vendorId: 'Vendor ID',
      name: 'Name',
      amount: 'Amount',
      currency: 'Currency',
      availableHint: 'Availability hint',
      publishedAt: 'Published at',
      code: 'Reference',
      description: 'Description',
      brandId: 'Brand ID',
      fitsDeviceModelIds: 'Compatible phones',
      categoryId: 'Category ID',
      media: 'Images',
    },
  },
  'checkout-group': {
    // Opened by the checkout flow, never by a person; a buyer reads it as their
    // receipt across sellers, and a vendor never reads it at all.
    form: {
      editTitle: 'Checkout',
      newTitle: 'Checkout',
    },
    label: 'Checkout',
    plural: 'Checkouts',
    fields: {
      id: 'ID',
      number: 'Number',
      buyerId: 'Buyer ID',
      orderIds: 'Orders',
      totals: 'Totals',
      total: {
        amount: 'Amount',
        currency: 'Currency',
      },
      placedAt: 'Placed at',
      cancelDigest: 'Cancel digest',
      cancelWindowEndsAt: 'Cancel window ends at',
      receiptEndsAt: 'Receipt available until',
      accessDigest: 'Access link digest',
      accessExpiresAt: 'Access link valid until',
      accessSentAt: 'Access link sent',
      contact: 'Contact and delivery',
      buyer: {
        name: 'Name',
        phone: 'Phone',
        email: 'Email',
        departamento: 'Departamento',
        municipio: 'Municipio',
        zona: 'Zona',
        addressLine: 'Address',
        reference: 'Reference',
      },
      locale: 'Language',
      redactedAt: 'Personal details removed on',
    },
    useCases: {
      sendAccessLink: 'Send an access link',
    },
  },
  'product-order': {
    // ⚠️ A form title for a record nobody creates by hand, exactly as
    // `stock-item` carries one. `newTitle` is the catalog gate
    // `EntityCatalogKey` reads, not a promise that a New button exists: no role
    // holds `product-order:write`, the write takes a crossing token and no
    // session, and the served descriptor withholds Save.
    form: {
      editTitle: 'Order',
      newTitle: 'Order',
    },
    label: 'Order',
    plural: 'Orders',
    fields: {
      id: 'ID',
      number: 'Number',
      buyerId: 'Buyer ID',
      vendorId: 'Vendor',
      groupId: 'Checkout',
      paymentMethod: 'Payment',
      status: 'Status',
      items: 'Lines',
      /**
       * One line's members. `items` is a `composition`, so the detail grid
       * takes its columns from `OrderItem`'s metadata and needs these keys —
       * nested under the master because a line is not an entity and has no
       * `@entity({ key })` of its own to hang them off.
       */
      item: {
        offeringId: 'Offering ID',
        name: 'Sold as',
        quantity: 'Quantity',
        amount: 'Amount',
        currency: 'Currency',
        reservationId: 'Reservation ID',
      },
      channel: 'Sales channel',
      placedAt: 'Placed at',
      paidAt: 'Paid at',
    },
    values: {
      status: {
        pending: 'Pending',
        paid: 'Paid',
        confirmed: 'Confirmed',
        cancelling: 'Cancelling',
        dispatched: 'Dispatched',
        fulfilled: 'Fulfilled',
        cancelled: 'Cancelled',
      },
      paymentMethod: {
        card: 'Card',
        cash: 'Cash',
        cod: 'Cash on delivery',
      },
    },
    useCases: {
      cancel: 'Cancel order',
      cancelConfirm:
        'The buyer will be refunded and the units will go back into your stock. This cannot be undone: charging again is a new purchase.',
    },
  },
  payment: {
    label: 'Payment',
    plural: 'Payments',
    fields: {
      id: 'ID',
      groupId: 'Checkout ID',
      amount: 'Amount',
      currency: 'Currency',
      status: 'Status',
      paymentMethod: 'Payment method',
      channelId: 'Channel ID',
      providerReference: 'Provider reference',
    },
    values: {
      status: {
        pending: 'Pending',
        authorized: 'Authorized',
        captured: 'Captured',
        failed: 'Failed',
      },
      method: {
        cash: 'Cash',
        card: 'Card',
        voucher: 'Voucher',
        transfer: 'Transfer',
        cod: 'Cash on delivery',
      },
    },
  },
  'payment-allocation': {
    label: 'Payment allocation',
    plural: 'Payment allocations',
    fields: {
      id: 'ID',
      paymentId: 'Payment ID',
      groupId: 'Checkout ID',
      orderId: 'Order ID',
      vendorId: 'Vendor ID',
      authorized: 'Authorized',
      captured: 'Captured',
      refunded: 'Refunded',
      currency: 'Currency',
      paymentMethod: 'Payment method',
    },
  },
  refund: {
    label: 'Refund',
    plural: 'Refunds',
    fields: {
      id: 'ID',
      allocationId: 'Allocation ID',
      orderId: 'Order ID',
      amount: 'Amount',
      currency: 'Currency',
      status: 'Status',
      providerReference: 'Provider reference',
      decidedAt: 'Decided at',
    },
    values: {
      status: {
        pending: 'Pending',
        refunded: 'Refunded',
        failed: 'Failed',
      },
    },
  },
  agreement: {
    form: {
      editTitle: 'Edit agreement',
      newTitle: 'New agreement',
    },
    label: 'Agreement',
    plural: 'Agreements',
    fields: {
      id: 'ID',
      vendorId: 'Vendor',
      commissionBasisPoints: 'Commission (basis points)',
      channelCommissionBasisPoints: 'Commission per channel (basis points)',
      effectiveFrom: 'Effective from',
    },
  },
  'commission-entry': {
    form: {
      editTitle: 'Commission entry',
      newTitle: 'Commission entry',
    },
    label: 'Commission entry',
    plural: 'Commission entries',
    fields: {
      collectedBy: 'Collected by',
      id: 'ID',
      orderId: 'Order ID',
      vendorId: 'Vendor',
      saleAmount: 'Sale amount',
      commissionAmount: 'Commission amount',
      currency: 'Currency',
      occurredAt: 'Sale date',
      runId: 'Settlement run',
      kind: 'Kind',
    },
    values: {
      collectedBy: {
        platform: 'Platform',
        vendor: 'Vendor',
      },
      kind: {
        sale: 'Sale',
        reversal: 'Reversal',
      },
    },
  },
  'settlement-run': {
    form: {
      editTitle: 'Settlement run',
      newTitle: 'Settlement run',
    },
    label: 'Settlement run',
    plural: 'Settlement runs',
    fields: {
      id: 'ID',
      periodStart: 'Period start',
      periodEnd: 'Period end',
      status: 'Status',
    },
    values: {
      status: {
        open: 'Open',
        calculated: 'Calculated',
        paid: 'Paid',
        cancelled: 'Cancelled',
      },
    },
  },
  'vendor-payout': {
    form: {
      editTitle: 'Vendor payout',
      newTitle: 'Vendor payout',
    },
    label: 'Vendor payout',
    plural: 'Vendor payouts',
    fields: {
      id: 'ID',
      runId: 'Settlement run',
      vendorId: 'Vendor',
      amount: 'Amount',
      currency: 'Currency',
    },
  },
  'product-offering': {
    form: {
      editTitle: 'Edit product offering',
      newTitle: 'New product offering',
    },
    label: 'Product offering',
    plural: 'Product offerings',
    fields: {
      id: 'ID',
      name: 'Name',
      specificationId: 'Specification',
      status: 'Status',
      statusChangedAt: 'Last status change',
    },
    values: {
      status: {
        draft: 'Draft',
        'pending-review': 'Pending review',
        published: 'Published',
        unpublished: 'Unpublished',
      },
    },
    useCases: {
      publish: 'Publish',
      publishConfirm:
        'The offering becomes visible in the storefront at its current price. Publishing again replaces what was shown before, in full.',
      unpublish: 'Unpublish',
      unpublishConfirm:
        'The offering stops being visible in the storefront and is removed from the published catalog. Your own copy is kept: you can publish it again.',
    },
    related: {
      price: 'Price',
      image: 'Image',
      available: 'Available',
    },
  },
  'product-offering-price': {
    form: {
      editTitle: 'Edit price',
      newTitle: 'New price',
    },
    label: 'Offering price',
    plural: 'Offering prices',
    fields: {
      id: 'ID',
      offeringId: 'Product',
      amount: 'Amount',
      currency: 'Currency',
    },
  },
  'entity-specification': {
    label: 'Specification',
    plural: 'Specifications',
    fields: {
      id: 'ID',
      name: 'Name',
      version: 'Version',
      released: 'Released',
    },
  },
  'characteristic-specification': {
    label: 'Characteristic',
    plural: 'Characteristics',
    fields: {
      id: 'ID',
      specificationId: 'Specification ID',
      code: 'Code',
      valueType: 'Value type',
      termId: 'Dictionary term',
    },
    values: {
      valueType: {
        string: 'Text',
        number: 'Number',
        boolean: 'Yes/No',
        enum: 'Value list',
      },
    },
  },
  'sales-channel': {
    form: {
      editTitle: 'Edit sales channel',
      newTitle: 'New sales channel',
    },
    label: 'Sales channel',
    plural: 'Sales channels',
    fields: {
      id: 'ID',
      name: 'Name',
      type: 'Type',
      status: 'Status',
    },
    values: {
      type: {
        storefront: 'Storefront',
        counter: 'Counter',
        phone: 'Phone',
        external: 'External',
      },
      status: {
        active: 'Active',
        inactive: 'Inactive',
      },
    },
    useCases: {
      sell: 'Sell through this channel',
    },
  },
  'stock-item': {
    // ⚠️ A form title for a record nobody creates by hand. `newTitle` is the
    // catalog gate `EntityCatalogKey` reads, not a promise that a New button
    // exists: there is no `stock-item:write` grant and no save route, so the
    // served descriptor withholds Save and the screen is read-only.
    form: {
      editTitle: 'Stock item',
      newTitle: 'Stock item',
    },
    label: 'Stock item',
    plural: 'Stock items',
    fields: {
      id: 'ID',
      offeringId: 'Product',
      onHand: 'On hand',
      reserved: 'Reserved',
      available: 'Available',
    },
  },
  'stock-movement': {
    // The one write surface in this domain: a movement, with a signed quantity
    // and a reason. Recording one is how a total moves.
    form: {
      editTitle: 'Stock movement',
      newTitle: 'Record movement',
    },
    label: 'Stock movement',
    plural: 'Stock movements',
    fields: {
      id: 'ID',
      offeringId: 'Product',
      quantity: 'Quantity',
      reason: 'Reason',
    },
    values: {
      reason: {
        receipt: 'Receipt',
        sale: 'Sale',
        cancellation: 'Cancellation',
        return: 'Return',
        adjustment: 'Adjustment',
      },
    },
  },
  reservation: {
    // Written by the checkout crossing, never by a person — so this titles a
    // record being read, and the "new" case never arises.
    form: {
      editTitle: 'Reservation',
      newTitle: 'Reservation',
    },
    label: 'Reservation',
    plural: 'Reservations',
    fields: {
      id: 'ID',
      offeringId: 'Product',
      quantity: 'Quantity',
      status: 'Status',
      expiresAt: 'Expires at',
    },
    values: {
      status: {
        held: 'Held',
        converted: 'Converted',
        released: 'Released',
      },
    },
  },
  'shipping-order': {
    // Opened by a flow once a checkout commits, never by a person — so this
    // titles a record being read; the vendor moves it with the verbs below.
    form: {
      editTitle: 'Shipment',
      newTitle: 'Shipment',
    },
    label: 'Shipment',
    plural: 'Shipments',
    fields: {
      id: 'ID',
      orderId: 'Order',
      orderNumber: 'Order number',
      destination: 'Delivery',
      recipient: {
        name: 'Recipient',
        phone: 'Phone',
        departamento: 'Departamento',
        municipio: 'Municipio',
        zona: 'Zona',
        addressLine: 'Address',
        reference: 'Reference',
      },
      redactedAt: 'Delivery details removed on',
      groupId: 'Checkout',
      flowId: 'Flow',
      paymentMethod: 'Payment',
      amountDue: 'Due on delivery',
      currency: 'Currency',
      lines: 'Lines',
      line: {
        offeringId: 'Product',
        name: 'Sold as',
        quantity: 'Quantity',
      },
      status: 'Status',
      dispatchedAt: 'Dispatched at',
      deliveredAt: 'Delivered at',
      refusedAt: 'Refused at',
      returnedAt: 'Returned at',
      withdrawnAt: 'Withdrawn at',
    },
    values: {
      status: {
        'awaiting-dispatch': 'Awaiting dispatch',
        held: 'Held',
        dispatched: 'Dispatched',
        delivered: 'Delivered',
        refused: 'Refused',
        returned: 'Returned',
        withdrawn: 'Withdrawn',
      },
      paymentMethod: {
        card: 'Card',
        cash: 'Cash',
        cod: 'Cash on delivery',
      },
    },
    useCases: {
      dispatch: 'Dispatch',
      dispatchConfirm:
        'The parcel is handed to the courier and the order can no longer be cancelled. Only a refusal at the door brings the goods back.',
      'record-delivery': 'Record delivery',
      'record-refusal': 'Record refusal',
      recordRefusalConfirm:
        'The buyer refused the parcel, so the order closes without a sale. This cannot be taken back; record the return once the parcel is with you.',
      'record-return': 'Record return',
      recordReturnConfirm:
        'The returned goods go back into your stock and on sale again. This cannot be taken back.',
    },
  },
};
