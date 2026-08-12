'use client';

import { UserIdentity } from '@r10c/business-ts-authn';
import { EntityTable } from '@r10c/entifix-react-controls';
import { useState } from 'react';

import { useUsers } from './use-users';

/**
 * The user listing. `EntityTable` builds its columns, labels and value
 * formatting from `UserIdentity`'s own `@accessor()` metadata, so the `role`
 * aspect appears as a sortable, filterable enum column without this page saying
 * anything about it.
 */
export function UsersPage() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const { items, total, isLoading, error } = useUsers(page, pageSize);

  return (
    <>
      {error ? (
        <p role="alert" className="text-danger">
          {error}
        </p>
      ) : null}
      <EntityTable
        entityConstructor={UserIdentity}
        items={items}
        totalItems={total}
        currentPage={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        isLoading={isLoading}
        hrefFor={id => `/users/${String(id)}`}
        newHref="/users/new"
      />
    </>
  );
}
