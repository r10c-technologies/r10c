import type { EntityAction } from '../../types/EntityAction';
import type { UseCaseDescriptor } from '../describe/describe-entity-use-cases';

/**
 * What a caller may do with one entity, as answered by
 * `GET /api/<entity>/$metadata`.
 *
 * Both members are **already filtered against the verified principal** — the
 * service computes them through `PolicyDecisionTag`, so this is not a catalogue
 * of everything the model declares but of what this caller is permitted. A UI
 * renders it directly; it never re-checks, and it has nothing to re-check with.
 *
 * `actions` is here beside `useCases` because Save and Delete are the three most
 * common affordances on any screen and they have no descriptor — without them a
 * form would keep rendering its buttons unconditionally and the document would
 * describe only the rare half of the surface.
 */
export interface EntityMetadataDocument {
  /** The CRUD subset this caller holds, in {@link ENTITY_ACTIONS} order. */
  actions: EntityAction[];
  /** The declared use cases this caller may invoke, in declaration order. */
  useCases: UseCaseDescriptor[];
}
