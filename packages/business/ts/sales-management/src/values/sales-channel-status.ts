import type { EnumTone } from '@entifix/core';

/**
 * Whether a channel may take a sale right now.
 *
 * Two states rather than a boolean, because a channel is referenced by every
 * order placed through it and therefore can never be deleted — retiring one has
 * to be a state change, and a `deleted` flag reads as a soft delete nobody
 * audits. `inactive` is what a closed shop looks like.
 */
export const SalesChannelStatuses = ['active', 'inactive'] as const;

export type SalesChannelStatus = (typeof SalesChannelStatuses)[number];

/**
 * A status read at a glance: a channel that sells succeeds, and an inactive
 * one is neutral. A value with no tone reads neutral.
 */
export const SalesChannelStatusTones = {
  active: 'success',
} as const satisfies Readonly<Partial<Record<SalesChannelStatus, EnumTone>>>;

/** Narrow an unknown value to a status. */
export const isSalesChannelStatus = (
  value: unknown,
): value is SalesChannelStatus =>
  typeof value === 'string' &&
  (SalesChannelStatuses as readonly string[]).includes(value);
