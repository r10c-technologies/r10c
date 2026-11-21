import type { StoreFault } from '@entifix/core';
import { Context, type Effect } from 'effect';

/** One stored object as a listing names it. */
export interface StoredObject {
  readonly key: string;
  readonly writtenAt: Date;
}

/** The bytes of one object, with the media type they were written as. */
export interface ObjectBytes {
  readonly bytes: Uint8Array;
  readonly contentType: string;
}

/**
 * Where a file lives — a payment receipt today, product images later
 * ([ADR 0081](../../../../../docs/adr/0081-an-order-waits-for-a-payment-the-seller-confirms-and-a-receipt-is-a-file.md) §8).
 *
 * A `business:policy` port rather than a domain's own, because two domains may
 * not import each other and more than one will keep files. It knows **keys
 * and bytes**, never what a file means: who may read it, how long it is kept
 * and which record points at it are the owning domain's.
 *
 * A key is a `/`-separated path of `[A-Za-z0-9._-]` segments; an adapter
 * refuses anything else as a defect, so a key built from a request can never
 * walk out of the store.
 */
export interface ObjectStore {
  /** Write `bytes` under `key`, replacing what was there. */
  readonly put: (
    key: string,
    bytes: Uint8Array,
    contentType: string,
  ) => Effect.Effect<void, StoreFault>;
  /** The object under `key`, or `undefined` when there is none. */
  readonly get: (
    key: string,
  ) => Effect.Effect<ObjectBytes | undefined, StoreFault>;
  /** Remove `key`. Removing what is not there succeeds: a sweep retries. */
  readonly delete: (key: string) => Effect.Effect<void, StoreFault>;
  /** The objects under `prefix` written before `olderThan`. */
  readonly list: (
    prefix: string,
    olderThan: Date,
  ) => Effect.Effect<readonly StoredObject[], StoreFault>;
}

/** The object store a composition provides. */
export class ObjectStoreTag extends Context.Service<
  ObjectStoreTag,
  ObjectStore
>()('@r10c/business-ts-object-storage/ObjectStore') {}

const SEGMENT = /^[A-Za-z0-9._-]+$/;

/**
 * Whether `key` is one an adapter may write: non-empty segments of a safe
 * alphabet, none of them `.` or `..`. The check every adapter runs first.
 */
export const isObjectKey = (key: string): boolean =>
  key
    .split('/')
    .every(
      segment => SEGMENT.test(segment) && segment !== '.' && segment !== '..',
    );
