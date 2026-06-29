export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface MetaMethodHttp {
  method: HttpMethod;
  path: string;
}

export interface MetaMethodOptions {
  http?: MetaMethodHttp;
  returnType?: string;
}

export class MetaMethod {
  //#region Properties

  readonly name: string | symbol;
  readonly http?: MetaMethodHttp;
  readonly returnType?: string;

  //#endregion

  //#region Constructors
  constructor(name: string | symbol, options?: MetaMethodOptions) {
    this.name = name;
    this.http = options?.http;
    this.returnType = options?.returnType;
  }
  //#endregion

  //#region Methods
  //#endregion

  //#region Accessors
  //#endregion
}
