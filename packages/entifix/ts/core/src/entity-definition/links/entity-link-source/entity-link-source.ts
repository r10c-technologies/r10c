import { EntifixError } from '../../../base-entities/entifix-error';
import { Entity, EntityConstructor } from '../../../types/Entity';
import { FilterGroup } from '../../../types/EntityFiltering';
import { EntitySorting } from '../../../types/EntitySorting';

/**
 * A paged, filterable list of link targets, expressed as state plus the commands
 * that change it.
 *
 * The member names match what a table already renders from, so a browse dialog
 * forwards this object through untouched. It carries no Effect and no React: the
 * hook that produces it lives in the integration layer, the components that
 * consume it in the controls layer, and those two may not import each other —
 * this contract in `core` is what lets them meet.
 */
export interface EntityLinkListView<TEntity extends Entity> {
  items: ReadonlyArray<TEntity>;
  totalItems: number;
  currentPage: number;
  pageSize: number;
  isLoading: boolean;
  error?: EntifixError;
  filtering?: FilterGroup<TEntity>;
  sorting?: EntitySorting<TEntity>;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onFilteringChange: (filtering: FilterGroup<TEntity>) => void;
  onSortingChange: (sorting: EntitySorting<TEntity>) => void;
}

/** The quick half: a term, and the short list of matches it produces. */
export interface EntityLinkQuickSearch<TEntity extends Entity> {
  term: string;
  setTerm: (term: string) => void;
  options: ReadonlyArray<TEntity>;
  isLoading: boolean;
  error?: EntifixError;
}

/** The browse half: the full list view, plus the dialog holding it. */
export interface EntityLinkBrowse<
  TEntity extends Entity,
> extends EntityLinkListView<TEntity> {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

/**
 * Everything an editor needs in order to set one relation, and nothing about how
 * the targets are fetched.
 *
 * Two ways in, because they answer different questions: {@link quick} is
 * "I know roughly what it is called", {@link browse} is "I need to look at the
 * catalog and filter it". {@link selected} is the third, quieter one — a draft
 * restored from storage holds an id and no instance, and an id is not a name.
 */
export interface EntityLinkSource<TEntity extends Entity> {
  entityConstructor: EntityConstructor<TEntity>;
  /** Reads a target's display label, per the owner's `linkLabelProperty`. */
  labelOf: (entity: TEntity) => string;
  /**
   * The currently held id, resolved into something a form can use.
   *
   * `entity` is the whole target, not just its name, and that matters: a draft
   * restored from storage holds ids only, so the instance a `linkSerialization:
   * 'embedded'` member needs at submit is gone. Resolving the id was already
   * happening for the label — carrying the instance out is what lets the form
   * rehydrate its selection instead of quietly writing the `id` shape onto an
   * `embedded` member.
   */
  selected: { label?: string; entity?: TEntity; isLoading: boolean };
  quick: EntityLinkQuickSearch<TEntity>;
  browse: EntityLinkBrowse<TEntity>;
}
