import { authSlice } from './slices/auth.slice.js';
import { configSlice } from './slices/config.slice.js';
import { marketplaceAdminSlice } from './slices/marketplace-admin.slice.js';
import { transactionSlice } from './slices/transaction.slice.js';
import type { SliceDeclaration } from './types.js';

/**
 * Every slice in the repository. `slices.spec.ts` checks this list against what
 * the source tree actually does, so a new slice that is not listed here fails
 * the build rather than quietly becoming a second writer.
 */
export const SLICES: readonly SliceDeclaration[] = [
  authSlice,
  configSlice,
  marketplaceAdminSlice,
  transactionSlice,
];
