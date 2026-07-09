import type { EntityLinkResolver } from '@r10c/entifix-ts-core';
import { Context } from 'effect';

/**
 * DI tag for the {@link EntityLinkResolver} an environment provides so entity
 * links can materialize their targets. The composition root supplies a resolver
 * backed by the appropriate adapters (REST on the web, Mongo on the backend),
 * and use-cases that follow links yield this tag rather than depending on any
 * concrete repository.
 */
export class EntityLinkResolverTag extends Context.Tag('EntityLinkResolverTag')<
  EntityLinkResolverTag,
  EntityLinkResolver
>() {}
