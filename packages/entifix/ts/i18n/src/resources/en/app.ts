type EsApp = typeof import('../es/app').app;

export const app: EsApp = {
  admin: {
    brand: 'r10c Admin',
    title: 'r10c · Marketplace admin',
    description: 'Back office for the r10c marketplace.',
    nav: {
      dashboard: 'Dashboard',
      catalog: 'Catalog',
      products: 'Products',
      brands: 'Brands',
      categories: 'Categories',
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
};
