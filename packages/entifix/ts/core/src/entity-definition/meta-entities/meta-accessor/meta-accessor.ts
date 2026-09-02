export type MetaAccessorKind = 'getter' | 'setter';

/**
 * The kinds of value an accessor can hold, as far as generic UI and adapters
 * care. It is deliberately a presentation/behaviour taxonomy rather than a
 * TypeScript mirror: `id` and `enum` are strings at runtime but are rendered,
 * sorted and filtered differently.
 */
export const MetaAccessorTypes = [
  'string',
  'number',
  'boolean',
  'date',
  'enum',
  'id',
  'link',
  'linkCollection',
  'composition',
  'scalarCollection',
] as const;
export type MetaAccessorType = (typeof MetaAccessorTypes)[number];

/**
 * The class whose accessors describe one row of a `composition` member.
 *
 * Deliberately not `EntityConstructor`: a child of a composition is a **value**,
 * not an entity. It has no identity of its own, is never addressed apart from
 * the master that holds it, and therefore has no `id` for `Entity` to require.
 * What it does have is `@accessor()` metadata, which is written to its own
 * class's `Symbol.metadata` bag independently of `@entity()` — so a child is
 * described by its accessors and by nothing else.
 *
 * ⚠️ It is a **shape declaration, not a runtime constructor contract.** Children
 * arrive off the wire as plain objects — the serializer walks `instanceof
 * EntityLink`, not the declared type, so an embedded array passes straight
 * through — and ADR 0032 forbids a class instance inside an autosaved draft
 * anyway. Nothing may branch on `instanceof` against this constructor.
 */
export type ChildConstructor<TChild extends object = object> = new (
  // Mirrors `EntityConstructor`: the arguments are the child's business, only
  // the class identity matters here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ...args: any[]
) => TChild;

/**
 * The wire shape a relation takes: the target's foreign key, or the whole
 * target inlined. Declared here rather than next to `EntityLink` because it is
 * metadata about a member, not state of a link instance.
 */
export const EntityLinkSerializations = ['id', 'embedded'] as const;
export type EntityLinkSerialization = (typeof EntityLinkSerializations)[number];

export interface MetaAccessorOptions {
  alias?: string;
  type?: MetaAccessorType;
  readonly?: boolean;
  hidden?: boolean;
  /** Member must hold a value. Drives form validation; defaults to optional. */
  required?: boolean;
  /** Human label for UI. Falls back to a humanized `name`. */
  label?: string;
  /**
   * Translation key for the label, resolved by the presentation layer. Takes
   * precedence over `label`, which stays as the untranslated fallback for a
   * member that has no catalog entry yet.
   *
   * Keys mirror the entity's own `@entity({ key })`, so they are derivable
   * rather than invented: `entity:product-specification.fields.code`.
   */
  labelKey?: string;
  /** Opt in/out of sorting controls. Defaults per `type`. */
  sortable?: boolean;
  /** Opt in/out of filtering controls. Defaults per `type`. */
  filterable?: boolean;
  /** Default position among the entity's members; ties keep declaration order. */
  order?: number;
  /** Allowed values when `type` is `enum` — drives the filter value control. */
  enumValues?: readonly string[];
  /**
   * Catalog prefix for those values; a value's label is `${enumLabelKey}.${value}`.
   * Explicit rather than derived from `labelKey`, so a member whose values are
   * shared with another member can point both at one vocabulary.
   */
  enumLabelKey?: string;
  /** Property of a `link` target used as its display label. Default `name`. */
  linkLabelProperty?: string;
  /**
   * Property of a `link` target a picker searches on. Defaults to
   * {@link linkLabelProperty} — you search for what you read. It must be
   * `filterable` on the target entity, since member metadata is also the
   * server-side filter allowlist.
   */
  linkSearchProperty?: string;
  /**
   * How a `link` travels when its owner is serialized: as the target's scalar
   * foreign key (`id`, the default) or with the whole target inlined
   * (`embedded`). The serializer decides per *link instance* — it inlines
   * whatever `isLoaded` — so without this the shape a write takes would depend
   * on whether the form happened to hold the target. Declaring it on the entity
   * makes the wire shape a property of the relation instead of an accident of
   * the UI.
   */
  linkSerialization?: EntityLinkSerialization;
  /**
   * The class describing one row of a `composition` member — the child's own
   * `@accessor()` metadata is what a detail grid renders its columns from.
   *
   * A **thunk**, because a child module and the entity that owns it are usually
   * declared in the same package and a direct reference makes the decorator's
   * evaluation order load-bearing. Deferring the read to first use removes the
   * ordering question entirely, which is the same reason a to-one relation's
   * target is reached through a resolver rather than an import.
   *
   * Meaningless on any other type. There is no inference fallback: an empty
   * array cannot be told apart from an empty `string[]` at runtime, so a
   * collection must be declared.
   */
  childType?: () => ChildConstructor;
  /**
   * Reset this member when the record is copied.
   *
   * It lives on the **accessor**, not on a use case's descriptor, and that is a
   * decision already on file: ADR 0026 closed `UseCaseDescriptor` against
   * per-verb payloads and named this exact case, because a descriptor that
   * grows a field per verb ends up a union of every verb's arguments. Which
   * members a copy must not carry is a property of the *member* — a unique
   * code, an audit stamp, a sequence number — and it is the same answer however
   * the copy is triggered.
   *
   * The identity member is always reset and needs no flag.
   */
  resetOnClone?: boolean;
}

export class MetaAccessor {
  //#region Properties

  readonly name: string | symbol;
  readonly kind: MetaAccessorKind;
  readonly alias?: string;
  readonly type?: MetaAccessorType;
  readonly readonly?: boolean;
  readonly hidden?: boolean;
  readonly required?: boolean;
  readonly label?: string;
  readonly labelKey?: string;
  readonly sortable?: boolean;
  readonly filterable?: boolean;
  readonly order?: number;
  readonly enumValues?: readonly string[];
  readonly enumLabelKey?: string;
  readonly linkLabelProperty?: string;
  readonly linkSearchProperty?: string;
  readonly linkSerialization?: EntityLinkSerialization;
  readonly childType?: () => ChildConstructor;
  readonly resetOnClone?: boolean;

  //#endregion

  //#region Constructors
  constructor(
    name: string | symbol,
    kind: MetaAccessorKind,
    options?: MetaAccessorOptions,
  ) {
    this.name = name;
    this.kind = kind;
    this.alias = options?.alias;
    this.type = options?.type;
    this.readonly = options?.readonly;
    this.hidden = options?.hidden;
    this.required = options?.required;
    this.label = options?.label;
    this.labelKey = options?.labelKey;
    this.sortable = options?.sortable;
    this.filterable = options?.filterable;
    this.order = options?.order;
    this.enumValues = options?.enumValues;
    this.enumLabelKey = options?.enumLabelKey;
    this.linkLabelProperty = options?.linkLabelProperty;
    this.linkSearchProperty = options?.linkSearchProperty;
    this.linkSerialization = options?.linkSerialization;
    this.childType = options?.childType;
    this.resetOnClone = options?.resetOnClone;
  }
  //#endregion

  //#region Methods
  //#endregion

  //#region Accessors
  //#endregion
}
