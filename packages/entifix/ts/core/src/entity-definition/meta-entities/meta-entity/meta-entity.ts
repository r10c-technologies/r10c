export interface MetaEntityOptions {
  key?: string;
  domain?: string;
  /** Translation key for the entity's singular name, e.g. `entity:product-specification.label`. */
  labelKey?: string;
  /** Translation key for its plural, e.g. `entity:product-specification.plural`. */
  pluralKey?: string;
}

export class MetaEntity {
  //#region Properties
  readonly name: string;
  readonly key?: string;
  readonly domain?: string;
  readonly labelKey?: string;
  readonly pluralKey?: string;
  //#endregion

  //#region Constructors
  constructor(name: string, options?: MetaEntityOptions) {
    this.name = name;
    this.key = options?.key;
    this.domain = options?.domain;
    this.labelKey = options?.labelKey;
    this.pluralKey = options?.pluralKey;
  }
  //#endregion

  //#region Methods
  //#endregion

  //#region Accessors
  //#endregion
}
