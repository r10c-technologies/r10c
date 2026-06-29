import { EntityId, EntityLoadRequest, Entity } from '@r10c/entifix-ts-core';
import { Context } from 'effect';

export class EntityIdTag extends Context.Tag('EntityIdTag')<
  EntityIdTag,
  EntityId
>() {}

export class EntityLoadRequestTag extends Context.Tag('EntityLoadRequestTag')<
  EntityLoadRequestTag,
  EntityLoadRequest
>() {}

export class EntityTag extends Context.Tag('EntityTag')<EntityTag, Entity>() {}
