import type { MethodDecoratorContext } from '../../meta-types';

export class MetaMethod {
  //#region Properties
  //#endregion

  //#region Constructors
  constructor() {}
  //#endregion

  //#region Methods
  //#endregion

  //#region Accessors
  //#endregion

  //#region Static
  static fromContext(context: MethodDecoratorContext): MetaMethod {
    const metaMethod = new MetaMethod();
    return metaMethod;
  }
  //#endregion
}
