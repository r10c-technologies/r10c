// Use this file to export React client components (e.g. those with 'use client' directive) or other non-server utilities

export * from './lib/back-office';
export * from './lib/crud';
export * from './lib/i18n';
export * from './lib/session';
// Type-only, so it stays erased: the account-link *values* ship from `/server`
// (see src/server.ts), but `AccountMenuProps` names these types and a consumer
// of the client entry has to be able to name them too.
export type {
  AccountDestination,
  AccountLabelKey,
  AccountLink,
} from './lib/session/account-links';
export * from './lib/shells-next-common';
export * from './lib/workspace';
