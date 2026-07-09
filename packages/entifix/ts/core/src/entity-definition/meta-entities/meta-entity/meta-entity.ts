export interface MetaEntityOptions {
  key?: string;
  domain?: string;
}

export class MetaEntity {
  //#region Properties
  readonly name: string;
  readonly key?: string;
  readonly domain?: string;
  //#endregion

  //#region Constructors
  constructor(name: string, options?: MetaEntityOptions) {
    this.name = name;
    this.key = options?.key;
    this.domain = options?.domain;
  }
  //#endregion

  //#region Methods
  //#endregion

  //#region Accessors
  //#endregion
}
