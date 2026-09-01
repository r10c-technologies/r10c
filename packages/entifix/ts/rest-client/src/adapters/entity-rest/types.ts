import { ConfigurationExtractMode } from '@r10c/entifix-ts-core';

/**
 * How a create is sent to this entity's service.
 *
 * `entity` is the plain REST write: `POST` an entity envelope, get the stored
 * entity back. `command` is the CQRS write path — the client mints the
 * transaction id, `POST`s a `command` envelope and gets a `202` naming the
 * transaction, because the write completes asynchronously behind a saga.
 *
 * It is per entity rather than global because the two live side by side today:
 * `ProductSpecification` is transactional, while `ProductBrand` and
 * `ProductCategory` are plain writes on another service.
 */
export type EntityCreateProtocol = 'entity' | 'command';

export interface BuildEntityRestOptions {
  uriConfig: {
    key: string;
    group?: string;
    extractionMode?: ConfigurationExtractMode;
  };
  /** Defaults to `'entity'` — the plain REST write. */
  create?: EntityCreateProtocol;
}
