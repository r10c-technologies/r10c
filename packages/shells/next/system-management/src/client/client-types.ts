import type {
  ConfigurationRepositoryTag,
  EntityRepositoryTag,
} from '@r10c/entifix-ts-business';
import type { Context } from 'effect';

/**
 * The adapter set the system-management pages run against.
 *
 * One context per entity rather than one merged context: `EntityRepositoryTag` is
 * a single tag, so two entities' adapters would collide. Each page merges only
 * what it needs.
 */
export interface SystemManagementAdapters {
  readonly configurationRest: Context.Context<EntityRepositoryTag>;
  readonly configurationStore: Context.Context<ConfigurationRepositoryTag>;
}
