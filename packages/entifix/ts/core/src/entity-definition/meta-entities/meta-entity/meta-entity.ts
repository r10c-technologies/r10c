export interface MetaEntityOptions {
  name?: string;
  resource?: string;
}

export class MetaEntity {
  //#region Properties

  readonly name: string;
  readonly resource?: string;

  //#endregion

  //#region Constructors
  constructor(name: string, options?: Pick<MetaEntityOptions, 'resource'>) {
    this.name = name;
    this.resource = options?.resource;
  }
  //#endregion

  //#region Methods
  //#endregion

  //#region Accessors
  //#endregion
}
