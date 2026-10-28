import {
  EntityLoadRequestTag,
  type EntityRepositoryTag,
  loadUCFactory,
} from '@entifix/business';
import type {
  Entity,
  EntityLoadRequest,
  EntityPage,
  TransitionalFailure,
} from '@entifix/core';
import type { PublishedVendor } from '@r10c/business-ts-marketplace-vendor';
import { Context, Effect } from 'effect';

/**
 * What every read here requires: the `PublishedVendor` repository, and nothing
 * else. Which transport answers is the caller's choice, made at composition.
 */
export type VendorRead<A> = Effect.Effect<
  A,
  TransitionalFailure,
  EntityRepositoryTag
>;

/**
 * The most sellers one read names. A results page holds a page of offerings,
 * so it names at most that many vendors; the facet over the whole catalog
 * reads every seller, and a marketplace with more than this many is a
 * pagination question for that facet, not a silent truncation here.
 */
export const VENDOR_PAGE_SIZE = 200;

/** The cast `offerings.ts` explains: a filter names a member of one entity. */
const load = (
  request: EntityLoadRequest<Entity>,
): VendorRead<EntityPage<PublishedVendor>> =>
  loadUCFactory<PublishedVendor>().pipe(
    Effect.provide(Context.make(EntityLoadRequestTag, request)),
  ) as VendorRead<EntityPage<PublishedVendor>>;

/**
 * The sellers named by `vendorIds`, or every seller when none are given —
 * sorted by name, which is the order a seller facet lists them in.
 *
 * An empty list asks for nobody and reads nothing: `in ()` is not a query, and
 * a page of offerings with no vendor ids has no seller line to fill.
 */
export const loadVendors = (
  vendorIds?: readonly string[],
): VendorRead<readonly PublishedVendor[]> =>
  vendorIds !== undefined && vendorIds.length === 0
    ? Effect.succeed([])
    : load({
        ...(vendorIds === undefined
          ? {}
          : {
              filtering: [
                {
                  property: 'vendorId',
                  operator: 'in',
                  values: [...vendorIds],
                },
              ] as never,
            }),
        sorting: [{ 0: { property: 'displayName', type: 'asc' } }] as never,
        pageSize: VENDOR_PAGE_SIZE,
      }).pipe(Effect.map(page => page.items));

/**
 * One seller by id, or `undefined` when nothing was ever announced for it.
 *
 * A miss renders **no seller line** (ADR 0061): an absent line is honest, a
 * raw organization id is not. A load with a filter rather than a `get`, for
 * the reason `getOffering` gives — a miss and an outage must stay different.
 */
export const getVendor = (
  vendorId: string,
): VendorRead<PublishedVendor | undefined> =>
  load({
    filtering: [
      { property: 'vendorId', operator: 'eq', value: vendorId },
    ] as never,
    pageSize: 1,
  }).pipe(Effect.map(page => page.items[0]));
