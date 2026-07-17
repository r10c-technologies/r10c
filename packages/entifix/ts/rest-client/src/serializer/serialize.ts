// Serialization now lives in `@r10c/entifix-ts-core` (shared with the Mongo
// adapter). Re-exported here for back-compat.
export {
  serializeEntity,
  serializeEntityCollection,
  type SerializedEntity,
} from '@r10c/entifix-ts-core';
