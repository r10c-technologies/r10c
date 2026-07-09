import { Entity, EntityConstructor } from '../../../types/Entity';

export type MetaAccessorKind = 'getter' | 'setter';

export interface MetaAccessorOptions {
  alias?: string;
  type?: string;
  readonly?: boolean;
  hidden?: boolean;
}

export class MetaAccessor {
  //#region Properties

  readonly name: string | symbol;
  readonly kind: MetaAccessorKind;
  readonly alias?: string;
  readonly type?: string;
  readonly readonly?: boolean;
  readonly hidden?: boolean;
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
  }
  //#endregion

  //#region Methods
  //#endregion

  //#region Accessors
  //#endregion
}
