export type EntityId = string | number | symbol | undefined;

export interface Entity {
  id: EntityId;
}

export type EntityConstructor<TEntity extends Entity> = new (
  // Allow any arguments in the constructor, as we don't know the specific parameters for each entity.
  // The important part is that it returns an instance of TEntity.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ...args: any[]
) => TEntity;
