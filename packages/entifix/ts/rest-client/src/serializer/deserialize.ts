// The (de)serializer moved to `@r10c/entifix-ts-core` (it is transport-agnostic
// and shared by the Mongo adapter too). Re-exported here for back-compat with
// existing relative imports in the REST adapters.
export {
  deserializeSingleEntity,
  deserializeEntityCollection,
} from '@r10c/entifix-ts-core';
