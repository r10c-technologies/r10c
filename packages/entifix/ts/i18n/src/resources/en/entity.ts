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
  product: {
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
};
