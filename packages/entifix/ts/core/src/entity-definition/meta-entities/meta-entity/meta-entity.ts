import type { ClassDecoratorContext } from '../../meta-types';
import { EntifixBuildError } from '../../../base-entities/entifix-error';

const validateContext = (context: ClassDecoratorContext) => {
  const { kind, name } = context;

  if (kind !== 'class')
    throw new EntifixBuildError(
      'MetaEntity can only be created by classes. Check the @entity decorator usage.'
    );
  if (!name)
    throw new EntifixBuildError('context.name for MetaEntity is undefined.');

  return {
    name,
  };
};

export class MetaEntity {
  //#region Properties

  readonly name: string;

  //#endregion

  //#region Constructors
  constructor(name: string) {
    this.name = name;
  }
  //#endregion

  //#region Methods
  //#endregion

  //#region Accessors
  //#endregion

  //#region Static
  static fromContext(context: ClassDecoratorContext): MetaEntity {
    const { name } = validateContext(context);
    const metaEntity = new MetaEntity(name);
    return metaEntity;
  }
  //#endregion
}
