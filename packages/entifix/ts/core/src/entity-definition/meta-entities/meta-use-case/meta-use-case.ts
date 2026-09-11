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

/**
 * One place a verb can appear: a binding and a placement together.
 *
 * The pair is the unit rather than either half, because the two answer
 * different questions — placement decides the *surface* and binding decides the
 * *payload* — and a verb reachable from a row and from a selection differs in
 * both at once.
 */
export interface UseCaseCell {
  binding: UseCaseBinding;
  placement: UseCasePlacement;
}

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
  /**
   * Further places the same verb appears, beyond the {@link binding} and
   * {@link placement} above.
   *
   * ⚠️ **One verb, one permission, several surfaces.** Publishing an offering
   * from its form, from a row menu and over a selection is one act reached three
   * ways, and the alternative was three `@useCase()` classes — which `slices`
   * refuses anyway, since a verb key is the third segment of one permission and
   * two classes cannot share a key. Three classes would have meant three
   * permissions for one act, and a grant that let somebody publish one offering
   * but not twenty (#216).
   *
   * The primary cell stays where it is so that nothing already declared
   * changes, and so a descriptor still reads as "this verb lives here" with the
   * rest as additions.
   */
  alsoAt?: readonly UseCaseCell[];
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
  readonly alsoAt?: readonly UseCaseCell[];
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
    this.alsoAt = options.alsoAt;
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
