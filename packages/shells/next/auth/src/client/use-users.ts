'use client';

import { UserIdentity } from '@r10c/business-ts-authn';
import { readEntityPageEnvelope } from '@r10c/entifix-ts-core';
import { Effect } from 'effect';

import { useAsyncResource } from './use-async-resource';

interface UsersPageData {
  items: UserIdentity[];
  total: number;
}

const readPage = async (
  page: number,
  pageSize: number,
): Promise<UsersPageData> => {
  const res = await fetch(
    `/api/user-identity?page=${page}&pageSize=${pageSize}`,
    { cache: 'no-store' },
  );
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body?.error ?? 'could not load users');
  }
  // The wire shape is the shared `entityPage` envelope, so the same reader the
  // REST adapters use rebuilds real entities here — which is what lets
  // `EntityTable` derive its columns from the metadata. Reading the envelope
  // rather than hand-picking `body.items`/`body.total` is also what makes a
  // malformed body a typed failure instead of an empty table.
  const page = Effect.runSync(readEntityPageEnvelope(UserIdentity, body));
  return { items: page.items, total: page.total };
};

/**
 * Load a page of users from this app's proxy route. Deliberately a small
 * `fetch` rather than the Effect/REST adapter stack the catalog uses: the
 * back-office reads one collection through a same-origin handler, and there is
 * no transport to swap.
 */
export function useUsers(page: number, pageSize: number) {
  const { data, isLoading, error } = useAsyncResource(
    `users:${page}:${pageSize}`,
    () => readPage(page, pageSize),
  );

  return {
    items: data?.items ?? [],
    total: data?.total ?? 0,
    isLoading,
    error,
  };
}
