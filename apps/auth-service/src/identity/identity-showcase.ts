import {
  EntityIdentifier,
  IdentifierType,
  UserIdentity,
} from '@r10c/business-ts-authn';
import { extractMetaAccessors, extractMetaEntity } from '@r10c/entifix-ts-core';

/**
 * The proof this whole spike exists for: construct entifix entity CLASSES and
 * read their stage-3 decorator metadata, at runtime, inside a backend HTTP
 * service. The Nest `auth-api` cannot do this — its legacy-decorator build
 * miscompiles `@entity`/`@accessor` and throws `EntifixBuildError` at boot, so
 * it is confined to the framework-free `/contracts` surface. Here the entities
 * are first-class.
 *
 * If the decorators were compiled in the wrong mode, `extractMetaEntity` would
 * throw. A 200 with populated metadata is the green light.
 */
export function describeIdentityModel() {
  const user = new UserIdentity();
  user.displayName = 'Ada Lovelace';

  const email = new EntityIdentifier(IdentifierType.Email, 'ada@example.com');
  email.verified = true;

  const userMeta = extractMetaEntity(UserIdentity);
  const identifierMeta = extractMetaEntity(EntityIdentifier);

  return {
    userEntity: {
      name: userMeta.name,
      key: userMeta.key,
      domain: userMeta.domain,
      accessors: extractMetaAccessors(UserIdentity).map((a) => ({
        name: String(a.name),
        kind: a.kind,
      })),
    },
    identifierEntity: {
      name: identifierMeta.name,
      key: identifierMeta.key,
      domain: identifierMeta.domain,
    },
    sample: {
      displayName: user.displayName,
      status: user.status,
      email: email.value,
      verified: email.verified,
    },
  };
}
