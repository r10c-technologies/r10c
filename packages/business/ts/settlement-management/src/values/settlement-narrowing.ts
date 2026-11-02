import {
  type ResolutionRule,
  type VerifiedContext,
  When,
} from '@entifix/business';
import type { Entity, FilterGroup } from '@entifix/core';

/** A settlement record that belongs to one vendor. */
export interface VendorScoped {
  readonly vendorId: string;
}

/** Which records a caller may see: all, none, or the ones a filter keeps. */
export type SettlementNarrowing<TEntity extends Entity> =
  'unscoped' | 'nothing' | FilterGroup<TEntity>;

/**
 * Every settlement read narrowed to its caller (ADR 0053, as a resolver since
 * ADR 0065): platform staff read across vendors, a vendor reads their own
 * terms, ledger lines and payouts, and everybody else — a buyer, a vendor
 * session with no organization — matches no rule and sees nothing.
 */
export const settlementNarrowing = <
  TEntity extends Entity & VendorScoped,
>(): readonly ResolutionRule<
  (context: VerifiedContext) => SettlementNarrowing<TEntity>
>[] => [
  When(context => context.partyRole === 'operator').use({
    name: 'operator',
    impl: () => 'unscoped',
  }),
  When(context => context.partyRole === 'vendor').use({
    name: 'vendor',
    // A vendor session with no organization owns nothing to be shown.
    impl: ({ organizationId }): SettlementNarrowing<TEntity> =>
      organizationId === undefined
        ? 'nothing'
        : {
            operator: 'and',
            values: [
              {
                property: 'vendorId',
                operator: 'eq',
                // `VendorScoped` makes it a string, but TypeScript will not
                // assign a string to a generic entity's indexed member.
                value: organizationId as TEntity['vendorId'],
              },
            ],
          },
  }),
];
