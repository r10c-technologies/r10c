type EsEntity = typeof import('../es/entity').entity;

export const entity: EsEntity = {
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
};
