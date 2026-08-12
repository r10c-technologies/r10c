// Client surface of the system-management shell.
//
// This package is `layer:shell` + **`scope:shared`**, unlike
// `shells-next-marketplace-admin` which is scoped to its own app. That asymmetry
// is deliberate: these screens are mounted by back-office-app today and by
// a dedicated management app later, and a scoped shell could be reached by
// neither without an illegal boundary edge or a copy. Do not "fix" the
// inconsistency by scoping it.
//
// The consequence is that nothing here may import `scope:marketplace-admin`, so
// this shell carries its own REST adapters and its own proxy route factory.

export * from './client/client-types';
export * from './client/configuration-form';
export * from './client/configuration-list/configuration-list-client-page';
export * from './client/configuration-single-view/configuration-single-view-client-page';
export * from './client/slug';
export * from './client/system-management-context';
export * from './nav';
