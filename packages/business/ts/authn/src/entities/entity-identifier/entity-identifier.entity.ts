import type { Entity, EntityId } from '@r10c/entifix-ts-core';
import { accessor, entity } from '@r10c/entifix-ts-core';

/**
 * The ways a user can present themselves at login. Every identifier resolves to
 * exactly one canonical {@link UserIdentity} — this is the "one user, many
 * identifiers" model. `external-subject` is an id minted by an upstream IdP
 * (e.g. a Zitadel/Keycloak `sub`); it is stored as just another identifier so
 * the canonical user id stays independent of any provider.
 */
export const IdentifierType = {
  Email: 'email',
  Username: 'username',
  Phone: 'phone',
  OAuth: 'oauth',
  ExternalSubject: 'external-subject',
} as const;

export type IdentifierType = (typeof IdentifierType)[keyof typeof IdentifierType];

@entity({ domain: 'authn', key: 'entity-identifier' })
export class EntityIdentifier implements Entity {
  // #region properties
  #id?: EntityId;
  #userId?: EntityId;
  #type: IdentifierType;
  #value: string;
  #provider?: string;
  #verified = false;
  // #endregion

  // #region constructors
  constructor(type: IdentifierType, value: string) {
    this.#type = type;
    this.#value = value;
  }
  // #endregion

  // #region accessors
  @accessor()
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  /** Foreign key to the canonical {@link UserIdentity} this identifier belongs to. */
  @accessor()
  get userId(): EntityId {
    return this.#userId;
  }
  set userId(value: EntityId) {
    this.#userId = value;
  }

  @accessor()
  get type(): IdentifierType {
    return this.#type;
  }
  set type(value: IdentifierType) {
    this.#type = value;
  }

  /** The identifier string: the email address, username, phone, or IdP subject. */
  @accessor()
  get value(): string {
    return this.#value;
  }
  set value(value: string) {
    this.#value = value;
  }

  /** Issuer for federated identifiers (e.g. `google`, `zitadel`); unset for local ones. */
  @accessor()
  get provider(): string | undefined {
    return this.#provider;
  }
  set provider(value: string | undefined) {
    this.#provider = value;
  }

  /**
   * Whether this identifier is proven to belong to the user. An unverified
   * identifier must never be used to link to or authenticate an existing
   * account — that is the classic account-takeover vector.
   */
  @accessor()
  get verified(): boolean {
    return this.#verified;
  }
  set verified(value: boolean) {
    this.#verified = value;
  }
  // #endregion
}
