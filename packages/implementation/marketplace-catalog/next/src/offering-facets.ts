import type { Entity, EntityConstructor } from '@entifix/core';
import { PublishedOffering } from '@r10c/business-ts-marketplace-catalog';
import type { FacetDefinition } from '@r10c/utils-react-ui';

import { assertQueryable } from './allowlist.js';
import {
  searchHref,
  type SearchKey,
  type SearchState,
} from './search-query.js';

export type FacetKind = FacetDefinition['kind'];

/**
 * What a member's declared type makes it as a facet. A string is a set of
 * values to pick from, a number is a range typed in, and a boolean is on or
 * off. A member of any other type is not a facet.
 */
const KIND_BY_TYPE: Readonly<Record<string, FacetKind>> = {
  string: 'checkbox',
  number: 'range',
  boolean: 'toggle',
};

/**
 * Each facet's kind, read from the entity class rather than written down.
 *
 * It reads the class, not the served `$metadata`: that document is behind a
 * session (marketplace-service `routes.ts`), and the storefront is anonymous.
 * A member must also be `filterable`, because a facet is a filter.
 */
export const facetKinds = <TEntity extends Entity, TFacet extends string>(
  entity: EntityConstructor<TEntity>,
  members: Readonly<Record<TFacet, keyof TEntity & string>>,
): Readonly<Record<TFacet, FacetKind>> => {
  const allowed = assertQueryable(
    entity,
    'filterable',
    Object.values(members) as (keyof TEntity & string)[],
  );
  const kinds = {} as Record<TFacet, FacetKind>;
  for (const [facet, member] of Object.entries(members) as [TFacet, string][]) {
    const type = allowed.get(member)?.type as string;
    const kind = KIND_BY_TYPE[type];
    if (kind === undefined) {
      throw new Error(
        `${entity.name}: ${member} is a ${type}, which is not a facet`,
      );
    }
    kinds[facet] = kind;
  }
  return kinds;
};

/**
 * The storefront's facets, in the order the panel shows them, and the
 * `PublishedOffering` member each one filters. A facet's id is also its search
 * parameter, except the price, which is the `min`/`max` pair.
 */
export const OFFERING_FACET_MEMBERS = {
  category: 'categoryId',
  brand: 'brandId',
  seller: 'vendorId',
  price: 'amount',
  available: 'availableHint',
} as const satisfies Readonly<Record<string, keyof PublishedOffering>>;

export type OfferingFacet = keyof typeof OFFERING_FACET_MEMBERS;

const KINDS = facetKinds(PublishedOffering, OFFERING_FACET_MEMBERS);

/** One value a checkbox facet offers: an id the projection stores, and its name. */
export interface FacetChoice {
  readonly id: string;
  readonly name: string;
}

/** The storefront copy a panel needs, already translated. */
export interface OfferingFacetLabels extends Readonly<
  Record<OfferingFacet, string>
> {
  readonly min: string;
  readonly max: string;
  readonly apply: string;
}

export interface OfferingFacetContext {
  /** The listing the links lead back to, locale prefix included. */
  readonly path: string;
  readonly state: SearchState;
  /**
   * The values each checkbox facet offers, read from the vocabulary by the
   * shell. A checkbox facet handed none is left out, so a category page that
   * passes no categories shows no category facet.
   */
  readonly choices: Partial<
    Readonly<Record<OfferingFacet, readonly FacetChoice[]>>
  >;
  readonly labels: OfferingFacetLabels;
}

/** The category is one value at a time: a second one would be a second tree. */
const SINGLE: ReadonlySet<OfferingFacet> = new Set(['category']);

/** The parameters a range form submits itself, and so must not repeat. */
const RANGE_PARAMS: ReadonlySet<string> = new Set(['min', 'max', 'page']);

const toggled = (
  values: readonly string[],
  id: string,
  single: boolean,
): readonly string[] => {
  if (values.includes(id)) return values.filter(value => value !== id);
  return single ? [id] : [...values, id];
};

/**
 * The panel a listing shows, as data: every option's link computed through the
 * search codec, so choosing one lands on page 1 with the rest of the search
 * kept.
 */
export const offeringFacets = ({
  path,
  state,
  choices,
  labels,
}: OfferingFacetContext): readonly FacetDefinition[] =>
  (Object.keys(OFFERING_FACET_MEMBERS) as OfferingFacet[]).flatMap(
    (facet): FacetDefinition[] => {
      const label = labels[facet];
      switch (KINDS[facet]) {
        case 'checkbox': {
          const param = facet as SearchKey;
          const options = (choices[facet] ?? []).map(choice => ({
            label: choice.name,
            href: searchHref(path, state, {
              [param]: toggled(state[param], choice.id, SINGLE.has(facet)),
            }),
            selected: state[param].includes(choice.id),
          }));
          return options.length === 0
            ? []
            : [{ kind: 'checkbox', id: facet, label, options }];
        }
        case 'toggle': {
          const param = facet as SearchKey;
          const selected = state[param].length > 0;
          return [
            {
              kind: 'toggle',
              id: facet,
              label,
              selected,
              href: searchHref(path, state, {
                [param]: selected ? [] : ['1'],
              }),
            },
          ];
        }
        case 'range':
          return [
            {
              kind: 'range',
              id: facet,
              label,
              action: path,
              min: { name: 'min', label: labels.min, value: state.min[0] },
              max: { name: 'max', label: labels.max, value: state.max[0] },
              hidden: (Object.entries(state) as [SearchKey, string[]][])
                .filter(([key]) => !RANGE_PARAMS.has(key))
                .flatMap(([key, values]) =>
                  values.map(value => [key, value] as const),
                ),
              submitLabel: labels.apply,
            },
          ];
      }
    },
  );
