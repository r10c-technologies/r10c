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
    },
  },
  'user-identity': {
    label: 'User',
    plural: 'Users',
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
    },
  },
  'product-order': {
    label: 'Order',
    plural: 'Orders',
    fields: {
      id: 'ID',
      buyerId: 'Buyer ID',
      status: 'Status',
      items: 'Lines',
      channel: 'Sales channel',
      placedAt: 'Placed at',
    },
    values: {
      status: {
        pending: 'Pending',
        paid: 'Paid',
        fulfilled: 'Fulfilled',
        cancelled: 'Cancelled',
      },
    },
  },
  payment: {
    label: 'Payment',
    plural: 'Payments',
    fields: {
      id: 'ID',
      orderId: 'Order ID',
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
      },
    },
  },
  agreement: {
    label: 'Agreement',
    plural: 'Agreements',
    fields: {
      id: 'ID',
      vendorId: 'Vendor ID',
      commissionBasisPoints: 'Commission (basis points)',
      channelCommissionBasisPoints: 'Commission per channel (basis points)',
      effectiveFrom: 'Effective from',
    },
  },
  'commission-entry': {
    label: 'Commission entry',
    plural: 'Commission entries',
    fields: {
      id: 'ID',
      orderId: 'Order ID',
      vendorId: 'Vendor ID',
      commissionAmount: 'Commission amount',
      currency: 'Currency',
    },
  },
  'settlement-run': {
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
    label: 'Vendor payout',
    plural: 'Vendor payouts',
    fields: {
      id: 'ID',
      runId: 'Settlement run ID',
      vendorId: 'Vendor ID',
      amount: 'Amount',
      currency: 'Currency',
    },
  },
  'product-offering': {
    label: 'Product offering',
    plural: 'Product offerings',
    fields: {
      id: 'ID',
      name: 'Name',
      specificationId: 'Specification ID',
      status: 'Status',
    },
    values: {
      status: {
        draft: 'Draft',
        'pending-review': 'Pending review',
        published: 'Published',
        unpublished: 'Unpublished',
      },
    },
  },
  'product-offering-price': {
    label: 'Offering price',
    plural: 'Offering prices',
    fields: {
      id: 'ID',
      offeringId: 'Offering ID',
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
  },
  'stock-item': {
    label: 'Stock item',
    plural: 'Stock items',
    fields: {
      id: 'ID',
      offeringId: 'Offering ID',
      onHand: 'On hand',
      reserved: 'Reserved',
    },
  },
  'stock-movement': {
    label: 'Stock movement',
    plural: 'Stock movements',
    fields: {
      id: 'ID',
      offeringId: 'Offering ID',
      quantity: 'Quantity',
      reason: 'Reason',
    },
    values: {
      reason: {
        receipt: 'Receipt',
        sale: 'Sale',
        cancellation: 'Cancellation',
        adjustment: 'Adjustment',
      },
    },
  },
  reservation: {
    label: 'Reservation',
    plural: 'Reservations',
    fields: {
      id: 'ID',
      offeringId: 'Offering ID',
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
};
