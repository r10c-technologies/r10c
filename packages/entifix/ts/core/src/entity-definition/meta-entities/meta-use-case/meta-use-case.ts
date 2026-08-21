import type { Entity, EntityConstructor } from '../../../types/Entity';

/** What a use case acts on: one record, a selection, or nothing. */
export type UseCaseBinding = 'entity' | 'collection' | 'unbound';

/**
 * Where a surface puts the action. Deliberately **not** derivable from
 * {@link UseCaseBinding}: an entity-bound action can be determining (a footer
 * "Publish" that finalizes the page) or context-independent (a toolbar action
 * available whenever a record is open). Collapsing the two would force every
 * surface to re-derive a placement the author already knew.
 */
export type UseCasePlacement =
  'context-dependent' | 'context-independent' | 'determining';

/** Confirmation a surface must obtain before running the use case. */
export interface UseCaseConfirm {
  tone: 'destructive' | 'neutral';
  /** Catalog key. Copy never lives in a descriptor. */
  messageKey: string;
}

/**
 * What `@useCase()` declares.
 *
 * `entity` is the target the verb is registered against — it is what the
 * decorator appends to, and it is not part of the served descriptor.
 *
 * `labelKey` is mandatory and namespace-qualified, the `GuardedNavItem`
 * convention: i18n is mandatory and `react/jsx-no-literals` fails the build on a
 * string written into JSX, so a descriptor carrying copy could not be rendered.
 *
 * `keywordsKey` is a catalog key rather than a `string[]` so the command palette
 * matches across locales — a user typing an English term reaches a Spanish
 * command.
 */
export interface MetaUseCaseOptions<
  TKey extends string,
  TEntity extends Entity,
> {
  entity: EntityConstructor<TEntity>;
  key: TKey;
  binding: UseCaseBinding;
  placement: UseCasePlacement;
  labelKey: string;
  keywordsKey?: string;
  confirm?: UseCaseConfirm;
  /** Names a form a surface should open instead of acting immediately. */
  form?: string;
}

/**
 * What the use-case class's **own** metadata carries, as opposed to what is
 * appended to the entity. Two fields are enough to derive the permission, which
 * is what lets `permissionForUseCase(SomeUC)` take a single argument and keeps
 * the verb string written exactly once.
 */
export interface MetaUseCaseBinding {
  entity: EntityConstructor<Entity>;
  key: string;
}

export class MetaUseCase {
  //#region Properties
  readonly entity: EntityConstructor<Entity>;
  readonly key: string;
  readonly binding: UseCaseBinding;
  readonly placement: UseCasePlacement;
  readonly labelKey: string;
  readonly keywordsKey?: string;
  readonly confirm?: UseCaseConfirm;
  readonly form?: string;
  //#endregion

  //#region Constructors
  constructor(options: MetaUseCaseOptions<string, Entity>) {
    this.entity = options.entity;
    this.key = options.key;
    this.binding = options.binding;
    this.placement = options.placement;
    this.labelKey = options.labelKey;
    this.keywordsKey = options.keywordsKey;
    this.confirm = options.confirm;
    this.form = options.form;
  }
  //#endregion

  //#region Methods
  //#endregion

  //#region Accessors
  //#endregion
}
