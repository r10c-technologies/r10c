import type { Entity, EntityId } from '@r10c/entifix-ts-core';
import { accessor, entity } from '@r10c/entifix-ts-core';

/**
 * One row of the fleet's central configuration: the value of `key`, in `group`,
 * for the service named by `service`.
 *
 * The `domain`/`key` pair is what derives this entity's permissions
 * (`config:configuration:read|write|delete`) through `permissionForEntity`, so
 * guarding a route needs no new permission constant anywhere.
 *
 * **Every member's `alias` is its Postgres column.** The entifix serializer keys
 * a plain record by `alias ?? name`, in both directions, so the relational
 * adapter needs no table/column mapping of its own — the entity is the mapping.
 * That is why the members read as domain names (`groupName`, `isSecret`) while
 * the columns keep their SQL casing (`group_name`, `is_secret`).
 *
 * `id` is a surrogate: the table's natural key is the
 * `(service, group_name, key)` triple, but an entity is addressed by a single
 * {@link EntityId}, so the column was added and the triple kept as a `UNIQUE`
 * constraint. It is deliberately `filterable`, since "show me this row" is a
 * query the workspace makes.
 */
@entity({
  domain: 'config',
  key: 'configuration',
  labelKey: 'entity:configuration.label',
  pluralKey: 'entity:configuration.plural',
})
export class Configuration implements Entity {
  // #region properties
  #id?: EntityId;
  #service?: string;
  #groupName?: string;
  #key?: string;
  #value?: string;
  #isSecret?: boolean;
  #updatedAt?: Date;
  #updatedBy?: string;
  // #endregion

  // #region constructors
  // #endregion

  // #region methods
  // #endregion

  // #region accessors
  @accessor({
    type: 'id',
    label: 'ID',
    labelKey: 'entity:configuration.fields.id',
    filterable: true,
  })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  /** The consumer this row is for — the path param of `GET /api/config/:service`. */
  @accessor({
    type: 'string',
    label: 'Service',
    labelKey: 'entity:configuration.fields.service',
    required: true,
  })
  get service(): string | undefined {
    return this.#service;
  }
  set service(value: string | undefined) {
    this.#service = value;
  }

  @accessor({
    type: 'string',
    alias: 'group_name',
    label: 'Group',
    labelKey: 'entity:configuration.fields.groupName',
    required: true,
  })
  get groupName(): string | undefined {
    return this.#groupName;
  }
  set groupName(value: string | undefined) {
    this.#groupName = value;
  }

  @accessor({
    type: 'string',
    label: 'Key',
    labelKey: 'entity:configuration.fields.key',
    required: true,
  })
  get key(): string | undefined {
    return this.#key;
  }
  set key(value: string | undefined) {
    this.#key = value;
  }

  /**
   * The value. **Not filterable or sortable**, deliberately: this column holds
   * every datastore credential and the JWT signing key, and a filter is a read
   * primitive — `value==dev-jwt-…` would let a caller who may only *list* rows
   * confirm a secret by guessing it, one query at a time. Reads of a secret row
   * return `null` here; see {@link isSecret}.
   */
  @accessor({
    type: 'string',
    label: 'Value',
    labelKey: 'entity:configuration.fields.value',
    filterable: false,
    sortable: false,
  })
  get value(): string | undefined {
    return this.#value;
  }
  set value(value: string | undefined) {
    this.#value = value;
  }

  /**
   * Marks the value as write-only. The service blanks it on every read and, on a
   * write, treats an empty incoming value as "leave it alone" — so a secret can
   * be replaced but never read back through the CRUD.
   */
  @accessor({
    type: 'boolean',
    alias: 'is_secret',
    label: 'Secret',
    labelKey: 'entity:configuration.fields.isSecret',
  })
  get isSecret(): boolean | undefined {
    return this.#isSecret;
  }
  set isSecret(value: boolean | undefined) {
    this.#isSecret = value;
  }

  /**
   * Stamped by the service on every write; the full history is in
   * `configuration_audit`.
   *
   * Deliberately **not** `@accessor({ readonly: true })`. That flag removes a
   * member from serialization *and* deserialization, so a read-only stamp would
   * never reach the client either — it is for members that travel in neither
   * direction. What this member needs is server-owned-but-visible, which the
   * route provides the same way it already owns the id: it overwrites whatever
   * arrived in the body, so a client cannot forge an audit stamp. The edit form
   * hides the input through an `<EntityField>` slot rather than through metadata.
   */
  @accessor({
    type: 'date',
    alias: 'updated_at',
    label: 'Updated at',
    labelKey: 'entity:configuration.fields.updatedAt',
  })
  get updatedAt(): Date | undefined {
    return this.#updatedAt;
  }
  set updatedAt(value: Date | undefined) {
    this.#updatedAt = value;
  }

  /** See {@link updatedAt} — server-owned, and visible for the same reason. */
  @accessor({
    type: 'string',
    alias: 'updated_by',
    label: 'Updated by',
    labelKey: 'entity:configuration.fields.updatedBy',
  })
  get updatedBy(): string | undefined {
    return this.#updatedBy;
  }
  set updatedBy(value: string | undefined) {
    this.#updatedBy = value;
  }
  // #endregion
}
