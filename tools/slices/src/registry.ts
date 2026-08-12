import { authSlice } from './slices/auth.slice.js';
import { configSlice } from './slices/config.slice.js';
import { marketplaceSlice } from './slices/marketplace.slice.js';
import { marketplaceAdminSlice } from './slices/marketplace-admin.slice.js';
import { orderSlice } from './slices/order.slice.js';
import { paymentSlice } from './slices/payment.slice.js';
import { settlementSlice } from './slices/settlement.slice.js';
import { stockSlice } from './slices/stock.slice.js';
import { transactionSlice } from './slices/transaction.slice.js';
import type { SliceDeclaration } from './types.js';

/**
 * Every slice in the repository, running or not. `slices.spec.ts` checks this
 * list against what the source tree actually does, so a new slice that is not
 * listed here fails the build rather than quietly becoming a second writer.
 *
 * Four are `active` and five are `planned` — see `SliceStatus`. A planned slice
 * is held to the same three invariants; what it may not do is claim a
 * deployment, because a database handle opened for a store nothing writes is a
 * phantom store.
 */
export const SLICES: readonly SliceDeclaration[] = [
  authSlice,
  configSlice,
  marketplaceSlice,
  marketplaceAdminSlice,
  orderSlice,
  paymentSlice,
  settlementSlice,
  stockSlice,
  transactionSlice,
];
