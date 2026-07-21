import { EntifixBuildError } from '../base-entities/entifix-error';
import type { Entity, EntityConstructor } from '../types/Entity';
import type { EntityLoadRequest } from '../types/EntityLoadRequest';
import { coerceFiltering } from './coerce-rsql';
import { parseRsql } from './parse-rsql';
import { serializeRsql } from './serialize-rsql';
import { parseSort, serializeSort } from './sort-param';

/** The query parameters a load request is expressed in. */
export const RSQL_PARAM = 'rsql';
export const SORT_PARAM = 'sort';
export const PAGE_PARAM = 'page';
export const PAGE_SIZE_PARAM = 'pageSize';

export interface LoadRequestDefaults {
  page: number;
  pageSize: number;
  /** Upper bound on `pageSize`, so a client cannot ask for the whole table. */
  maxPageSize?: number;
}

const DEFAULTS: Required<LoadRequestDefaults> = {
  page: 1,
  pageSize: 10,
  maxPageSize: 200,
};

/**
 * Serializes a load request into query parameters. Empty filtering, empty
 * sorting and absent paging are all omitted rather than sent blank, so a plain
 * listing keeps a clean URL.
 */
export function serializeLoadRequestParams<TEntity extends Entity>(
  request: EntityLoadRequest<TEntity>,
): URLSearchParams {
  const params = new URLSearchParams();

  const rsql = serializeRsql(request.filtering);
  if (rsql !== '') params.set(RSQL_PARAM, rsql);

  const sort = serializeSort(request.sorting);
  if (sort !== '') params.set(SORT_PARAM, sort);

  if (request.page != null) params.set(PAGE_PARAM, String(request.page));
  if (request.pageSize != null) {
    params.set(PAGE_SIZE_PARAM, String(request.pageSize));
  }

  return params;
}

/** Reads a positive integer parameter, falling back when absent or unusable. */
function readPositiveInteger(
  params: URLSearchParams,
  name: string,
  fallback: number,
): number {
  const raw = params.get(name);
  if (raw === null || raw.trim() === '') return fallback;

  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new EntifixBuildError(
      `"${name}" must be a positive integer`,
      undefined,
      { [name]: raw },
    );
  }
  return value;
}

/**
 * Parses query parameters into an {@link EntityLoadRequest}, validated against
 * the entity's own metadata — the server-side half of the query protocol.
 *
 * Every failure mode (malformed RSQL, an unknown or non-filterable member, a
 * value that is not of the member's type, a nonsense page) is an
 * {@link EntifixBuildError}: the client sent something wrong, so it is a `400`
 * and never a `500`.
 */
export function parseLoadRequestParams<TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
  params: URLSearchParams,
  defaults: Partial<LoadRequestDefaults> = {},
): EntityLoadRequest<TEntity> {
  const { page, pageSize, maxPageSize } = { ...DEFAULTS, ...defaults };

  const expression = params.get(RSQL_PARAM);
  const filtering = expression?.trim()
    ? [coerceFiltering(entityConstructor, parseRsql(expression))]
    : undefined;

  const sorting = parseSort(entityConstructor, params.get(SORT_PARAM));

  const request: EntityLoadRequest<TEntity> = {
    page: readPositiveInteger(params, PAGE_PARAM, page),
    pageSize: Math.min(
      readPositiveInteger(params, PAGE_SIZE_PARAM, pageSize),
      maxPageSize,
    ),
  };

  if (filtering) request.filtering = filtering;
  if (sorting) request.sorting = sorting;

  return request;
}
