import type { Entity, EntityConstructor } from '../../types/Entity';
import type { EntityMetadataDocument } from './entity-metadata-document';

/**
 * Where a UI gets an entity's {@link EntityMetadataDocument} from.
 *
 * A port, for the same reason `EntityLinkSource` is one: the implementation that
 * fetches lives in the client layer, the components that render live in the
 * controls layer, and those two may not import each other — this contract in
 * `core` is what lets them meet. It carries no Effect and no React deliberately.
 *
 * The indirection is also what keeps use-case *implementations* out of a client
 * bundle. A browser must never import a `@useCase()` class: that would drag its
 * `Effect` body, its repository tags and its whole import closure across the
 * wire. It fetches descriptors instead.
 */
export interface EntityMetadataSource {
  fetchMetadata<TEntity extends Entity>(
    entityConstructor: EntityConstructor<TEntity>,
  ): Promise<EntityMetadataDocument>;
}
