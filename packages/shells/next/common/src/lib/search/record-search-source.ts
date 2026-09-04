import {
  describeEntityColumns,
  EntifixLogicError,
  type Entity,
  type EntityConstructor,
  type EntityFieldDescriptor,
  type EntityLoadRequest,
  envelopeEntityName,
  readEntityPageEnvelope,
  serializeLoadRequestParams,
} from '@r10c/entifix-ts-core';
import { Effect, Exit } from 'effect';

import type { RecordSearchOption } from './record-search.types';

/**
 * What a host declares in order to make one entity searchable from the palette
 * (ADR 0040).
 *
 * The search and label members are **declared**, not derived, and that is not an
 * oversight in the metadata: `linkSearchProperty`/`linkLabelProperty` are
 * properties of a *referring* accessor — they say how the owner of a relation
 * looks up its target — and an entity has no member that says "this is what I am
 * called". So the host that mounts the screens says it, next to the route those
 * screens live at.
 */
export interface RecordSearchSourceConfig<TEntity extends Entity> {
  /** Stable id, unique per host. Defaults to the entity's wire name. */
  readonly key?: string;
  readonly entityConstructor: EntityConstructor<TEntity>;
  /** Where the owning service listens, **without** the `/api` suffix. */
  readonly baseUrl: string;
  /** The `filterable` string member a term is matched against with `like`. */
  readonly searchProperty: string;
  /** The `sortable` member read as a record's label. */
  readonly labelProperty: string;
  /** An optional secondary line — a code, a role. */
  readonly sublabelProperty?: string;
  /** The group heading, as the entity's own `pluralKey`. */
  readonly labelKey: string;
  /** Where selecting a record lands. Locale-free; the caller prefixes it. */
  readonly href: (id: string) => string;
}

/** A declared source, reduced to what the fan-out actually calls. */
export interface RecordSearchSource {
  readonly key: string;
  readonly entity: string;
  readonly labelKey: string;
  /** The upstream URL for one term. */
  readonly url: (term: string, limit: number) => string;
  /** `undefined` when the body is not a readable `entityPage` envelope. */
  readonly read: (
    body: unknown,
  ) => { items: RecordSearchOption[]; total: number } | undefined;
}

const descriptorOf = (
  columns: EntityFieldDescriptor[],
  name: string,
): EntityFieldDescriptor | undefined =>
  columns.find(column => column.name === name);

const rejection = (
  entityName: string,
  member: string,
  because: string,
  fix: string,
): EntifixLogicError =>
  new EntifixLogicError(
    `Cannot search ${entityName} by "${member}": ${because} ${fix}`,
    undefined,
    { entity: entityName, member },
  );

/**
 * Declare a record search source, validating it against the entity's own
 * metadata **now** rather than on the first keystroke.
 *
 * Every check here guards a failure that is otherwise silent at both ends: the
 * service answers `400`, and a caller renders that as a group it could not
 * reach — which reads as "there are no products". `assertSearchable` took the
 * same posture for the relation picker, for the same reason.
 *
 * ⚠️ This throws at **module load**, so a bad declaration fails the whole app at
 * boot rather than just search. That is deliberate — a source silently missing
 * from a palette is indistinguishable from a permission the caller lacks — but
 * the blast radius is wider than the picker's, which fails only its own render.
 */
export const defineRecordSearchSource = <TEntity extends Entity>({
  key,
  entityConstructor,
  baseUrl,
  searchProperty,
  labelProperty,
  sublabelProperty,
  labelKey,
  href,
}: RecordSearchSourceConfig<TEntity>): RecordSearchSource => {
  const entity = envelopeEntityName(entityConstructor);
  const entityName = entityConstructor.name;
  const columns = describeEntityColumns(entityConstructor);

  const search = descriptorOf(columns, searchProperty);
  if (search === undefined) {
    throw rejection(
      entityName,
      searchProperty,
      'the entity declares no such member.',
      'Name a member the entity actually has.',
    );
  }
  // `filterable` is simultaneously the server-side RSQL allowlist.
  if (!search.filterable) {
    throw rejection(
      entityName,
      searchProperty,
      'the member is not filterable, so the service would reject the query.',
      'Declare it `filterable` on the entity, or search another member.',
    );
  }
  // A `like` against anything else reaches `coerceValue`, which rejects a
  // partial term — so an enum member reads as declarable and is permanently
  // broken: every keystroke short of a whole value answers `400`.
  if (search.type !== 'string') {
    throw rejection(
      entityName,
      searchProperty,
      `the member is a ${search.type}, and a partial term is not a valid value for it.`,
      'Search a string member instead.',
    );
  }

  const label = descriptorOf(columns, labelProperty);
  if (label === undefined) {
    throw rejection(
      entityName,
      labelProperty,
      'the entity declares no such label member.',
      'Name a member the entity actually has.',
    );
  }
  // The group is sorted by the label, so the flag is load-bearing: without it
  // the service rejects the sort and the group degrades whole. Unsorted was the
  // alternative and is worse — the services apply no default order, so results
  // would arrive in storage order and shuffle as records are rewritten.
  if (!label.sortable) {
    throw rejection(
      entityName,
      labelProperty,
      'the label member is not sortable, so the service would reject the sort.',
      'Declare it `sortable` on the entity, or label records by another member.',
    );
  }

  let sublabel: EntityFieldDescriptor | undefined;
  if (sublabelProperty !== undefined) {
    sublabel = descriptorOf(columns, sublabelProperty);
    if (sublabel === undefined) {
      throw rejection(
        entityName,
        sublabelProperty,
        'the entity declares no such sublabel member.',
        'Name a member the entity actually has, or drop `sublabelProperty`.',
      );
    }
  }

  const read = (
    body: unknown,
  ): { items: RecordSearchOption[]; total: number } | undefined => {
    const page = Effect.runSyncExit(
      readEntityPageEnvelope(entityConstructor, body),
    );
    if (Exit.isFailure(page)) return undefined;

    const items = page.value.items
      .filter(record => (record as Entity).id != null)
      .map(record => {
        const row = record as unknown as Record<string, unknown>;
        const raw = row[labelProperty];
        const id = String((record as Entity).id);
        return {
          id,
          // A blank label is as useless as a missing one, so both fall back to
          // the id — an unnamed record must stay distinguishable from the one
          // above it. Same rule the relation picker's `labelOf` applies.
          label: raw == null || raw === '' ? id : String(raw),
          ...(sublabel !== undefined && row[sublabel.name] != null
            ? { sublabel: String(row[sublabel.name]) }
            : {}),
          entity,
          href: href(id),
        } satisfies RecordSearchOption;
      });

    return { items, total: page.value.total };
  };

  return {
    key: key ?? entity,
    entity,
    labelKey,
    /**
     * Built through `serializeLoadRequestParams`, never by hand. That is
     * correctness rather than tidiness: `encodeRsqlValue` quotes a term carrying
     * any of `;,()'"=!<>\` or whitespace, so `Acme, Inc.` stays one value
     * instead of splitting the expression into two comparisons.
     */
    url: (term, limit) => {
      const request = {
        filtering: [
          {
            property: search.key,
            operator: 'like' as const,
            value: term,
          },
        ],
        sorting: [{ 0: { property: label.key, type: 'asc' as const } }],
        page: 1,
        pageSize: limit,
      } as unknown as EntityLoadRequest;

      return `${baseUrl}/api/${entity}?${serializeLoadRequestParams(request).toString()}`;
    },
    read,
  };
};
