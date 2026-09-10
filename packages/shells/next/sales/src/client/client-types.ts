import type {
  ConfigurationRepositoryTag,
  EntityRepositoryTag,
} from '@r10c/entifix-ts-business';
import type { Context } from 'effect/Context';

export interface SalesAdapters {
  salesChannelRest: Context<EntityRepositoryTag>;
  /**
   * The published projection the till prices from, read through the host's
   * marketplace proxy. It is a *different backend* from the one above, which is
   * the whole reason it is a second adapter rather than a second entity on the
   * first: a counter sale sells what the storefront sells, at the price the
   * storefront shows.
   */
  publishedOfferingRest: Context<EntityRepositoryTag>;
  configurationStore: Context<ConfigurationRepositoryTag>;
}
