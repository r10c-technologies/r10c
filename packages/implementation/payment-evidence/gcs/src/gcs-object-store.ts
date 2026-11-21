import { Unavailable } from '@entifix/core';
import { type Bucket, Storage } from '@google-cloud/storage';
import {
  isObjectKey,
  type ObjectStore,
} from '@r10c/business-ts-object-storage';
import { Effect } from 'effect';

/** One object of the bucket, as far as this store uses it. */
export interface GcsFile {
  readonly name: string;
  readonly metadata: {
    readonly timeCreated?: string;
    readonly contentType?: string;
  };
  save(
    bytes: Uint8Array,
    options: { readonly contentType: string; readonly resumable: false },
  ): Promise<unknown>;
  download(): Promise<[Uint8Array]>;
  getMetadata(): Promise<[{ readonly contentType?: string }]>;
  delete(options: { readonly ignoreNotFound: true }): Promise<unknown>;
}

/**
 * The slice of `@google-cloud/storage`'s `Bucket` this store calls, so a spec
 * can fake the driver one level below the adapter (ADR 0063) and the real one
 * still satisfies it.
 */
export interface GcsBucket {
  file(name: string): GcsFile;
  getFiles(options: {
    readonly prefix: string;
    readonly autoPaginate: true;
  }): Promise<[readonly GcsFile[], ...unknown[]]>;
}

/** The status a missing object answers with, from the bucket's API. */
const isNotFound = (error: unknown) =>
  (error as { code?: unknown }).code === 404;

/**
 * The cloud's object store: one Cloud Storage bucket
 * ([ADR 0081](../../../../../docs/adr/0081-an-order-waits-for-a-payment-the-seller-confirms-and-a-receipt-is-a-file.md) §8,
 * #692). The bucket is declared in `infra/gcp/storage.tf`, private and
 * uniform; the service reaches it as its own Google service account through
 * Workload Identity, so nothing here holds a key.
 *
 * A write is one non-resumable upload: a receipt is at most 5 MB, and a
 * resumable session is a second round trip for nothing.
 */
export const makeGcsObjectStore = (bucket: GcsBucket): ObjectStore => {
  const fault = () => new Unavailable({ dependency: 'payment-evidence' });
  const keyed = <A>(key: string, run: () => Promise<A>) =>
    isObjectKey(key)
      ? Effect.tryPromise({ try: run, catch: fault })
      : Effect.die(new Error(`not an object key: '${key}'`));

  return {
    put: (key, bytes, contentType) =>
      keyed(key, async () => {
        await bucket.file(key).save(bytes, { contentType, resumable: false });
      }),
    get: key =>
      keyed(key, async () => {
        const file = bucket.file(key);
        try {
          const [[bytes], [metadata]] = await Promise.all([
            file.download(),
            file.getMetadata(),
          ]);
          return {
            bytes: new Uint8Array(bytes),
            contentType: metadata.contentType ?? 'application/octet-stream',
          };
        } catch (error) {
          if (isNotFound(error)) return undefined;
          throw error;
        }
      }),
    delete: key =>
      keyed(key, async () => {
        await bucket.file(key).delete({ ignoreNotFound: true });
      }),
    list: (prefix, olderThan) =>
      Effect.tryPromise({
        try: async () => {
          const [files] = await bucket.getFiles({ prefix, autoPaginate: true });
          return files
            .map(file => ({
              key: file.name,
              writtenAt: new Date(file.metadata.timeCreated ?? 0),
            }))
            .filter(object => object.writtenAt < olderThan)
            .sort((a, b) => a.key.localeCompare(b.key));
        },
        catch: fault,
      }),
  };
};

/** A real bucket, typed as the slice this store calls. */
export const gcsBucketOf = (bucket: Bucket): GcsBucket =>
  bucket as unknown as GcsBucket;

/**
 * The store over the bucket named `name`, under the credentials the runtime
 * provides — the pod's Workload Identity on GKE. Nothing is dialled until the
 * first call, so a composition can build it at boot.
 */
export const makeBucketObjectStore = (name: string): ObjectStore =>
  makeGcsObjectStore(gcsBucketOf(new Storage().bucket(name)));
