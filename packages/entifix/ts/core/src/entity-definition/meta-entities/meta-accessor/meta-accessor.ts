import type {
  GetterDecoratorContext,
  SetterDecoratorContext,
} from '../../meta-types';

export class MetaAccessorGet {}

export class MetaAccessorSet {}

export class MetaAccessor {
  //#region Properties
  getter?: MetaAccessorGet;
  setter?: MetaAccessorSet;

  name?: string | symbol;
  //#endregion

  //#region Constructors
  //#endregion

  //#region Methods
  //#endregion

  //#region Accessors

  static fromContext(
    context: GetterDecoratorContext | SetterDecoratorContext
  ): MetaAccessor {
    const metaAccessor = new MetaAccessor();
    return metaAccessor;
  }

  static fromGetContext(context: GetterDecoratorContext): MetaAccessorGet {
    const metaAccessorGet = new MetaAccessorGet();
    return metaAccessorGet;
  }

  static fromSetContext(context: SetterDecoratorContext): MetaAccessorSet {
    const metaAccessorSet = new MetaAccessorSet();
    return metaAccessorSet;
  }
  //#endregion
}
