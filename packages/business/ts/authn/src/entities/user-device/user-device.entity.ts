import type { Entity, EntityId } from '@r10c/entifix-ts-core';
import { accessor, entity } from '@r10c/entifix-ts-core';

/**
 * A browser a user has signed in from, remembered across sessions.
 *
 * Durable on purpose. Sessions live in Redis and expire, so deriving "have I
 * seen this device before?" from live sessions alone would announce a familiar
 * laptop as new after a week away. A false "new device signed in" alert is
 * exactly what teaches people to ignore the true one, which is the only signal
 * that tells them their password leaked.
 *
 * The stored `deviceId` is the raw cookie value rather than a hash: it grants
 * nothing, so there is no secret here to protect. Everything on this entity is
 * a **label** — the authorization decision is made from the access token.
 */
@entity({
  domain: 'authn',
  key: 'user-device',
  labelKey: 'entity:user-device.label',
  pluralKey: 'entity:user-device.plural',
})
export class UserDevice implements Entity {
  // #region properties
  #id?: EntityId;
  #userId?: EntityId;
  #deviceId = '';
  #browser?: string;
  #os?: string;
  #type?: string;
  #lastIp?: string;
  #firstSeenAt?: Date;
  #lastSeenAt?: Date;
  // #endregion

  // #region accessors
  @accessor({ labelKey: 'entity:user-device.fields.id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({ labelKey: 'entity:user-device.fields.userId', filterable: true })
  get userId(): EntityId {
    return this.#userId;
  }
  set userId(value: EntityId) {
    this.#userId = value;
  }

  @accessor({
    labelKey: 'entity:user-device.fields.deviceId',
    filterable: true,
  })
  get deviceId(): string {
    return this.#deviceId;
  }
  set deviceId(value: string) {
    this.#deviceId = value;
  }

  @accessor({ labelKey: 'entity:user-device.fields.browser', sortable: true })
  get browser(): string | undefined {
    return this.#browser;
  }
  set browser(value: string | undefined) {
    this.#browser = value;
  }

  @accessor({ labelKey: 'entity:user-device.fields.os', sortable: true })
  get os(): string | undefined {
    return this.#os;
  }
  set os(value: string | undefined) {
    this.#os = value;
  }

  @accessor({ labelKey: 'entity:user-device.fields.type' })
  get type(): string | undefined {
    return this.#type;
  }
  set type(value: string | undefined) {
    this.#type = value;
  }

  @accessor({ labelKey: 'entity:user-device.fields.lastIp' })
  get lastIp(): string | undefined {
    return this.#lastIp;
  }
  set lastIp(value: string | undefined) {
    this.#lastIp = value;
  }

  @accessor({ type: 'date', labelKey: 'entity:user-device.fields.firstSeenAt' })
  get firstSeenAt(): Date | undefined {
    return this.#firstSeenAt;
  }
  set firstSeenAt(value: Date | undefined) {
    this.#firstSeenAt = value;
  }

  @accessor({
    type: 'date',
    labelKey: 'entity:user-device.fields.lastSeenAt',
    sortable: true,
  })
  get lastSeenAt(): Date | undefined {
    return this.#lastSeenAt;
  }
  set lastSeenAt(value: Date | undefined) {
    this.#lastSeenAt = value;
  }
  // #endregion
}
