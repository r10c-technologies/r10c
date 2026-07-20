import { Entity, EntityConstructor } from '../../../types/Entity';

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
] as const;
export type MetaAccessorType = (typeof MetaAccessorTypes)[number];

export interface MetaAccessorOptions {
  alias?: string;
  type?: MetaAccessorType;
  readonly?: boolean;
  hidden?: boolean;
  /** Human label for UI. Falls back to a humanized `name`. */
  label?: string;
  /** Opt in/out of sorting controls. Defaults per `type`. */
  sortable?: boolean;
  /** Opt in/out of filtering controls. Defaults per `type`. */
  filterable?: boolean;
  /** Default position among the entity's members; ties keep declaration order. */
  order?: number;
  /** Allowed values when `type` is `enum` — drives the filter value control. */
  enumValues?: readonly string[];
  /** Property of a `link` target used as its display label. Default `name`. */
  linkLabelProperty?: string;
}

export class MetaAccessor {
  //#region Properties

  readonly name: string | symbol;
  readonly kind: MetaAccessorKind;
  readonly alias?: string;
  readonly type?: MetaAccessorType;
  readonly readonly?: boolean;
  readonly hidden?: boolean;
  readonly label?: string;
  readonly sortable?: boolean;
  readonly filterable?: boolean;
  readonly order?: number;
  readonly enumValues?: readonly string[];
  readonly linkLabelProperty?: string;
  readonly entityConstructor?: EntityConstructor<Entity>;

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
    this.label = options?.label;
    this.sortable = options?.sortable;
    this.filterable = options?.filterable;
    this.order = options?.order;
    this.enumValues = options?.enumValues;
    this.linkLabelProperty = options?.linkLabelProperty;
  }
  //#endregion

  //#region Methods
  //#endregion

  //#region Accessors
  //#endregion
}
