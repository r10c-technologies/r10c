import { Product } from '@r10c/business-ts-product-configuration-management';
import { useDataLoading } from '@r10c/entifix-react-integration';
import {
  ConfigurationRepositoryTag,
  EntityLinkResolverTag,
  EntityRepositoryTag,
} from '@r10c/entifix-ts-business';

import type { ProductTableProps } from './product-table.types';

/**
 * Product listing. Unlike the generic {@link Table}, it renders the two
 * relations explicitly: `brand` arrives embedded and `category` as a foreign key
 * resolved by the load use-case — both are read here through the entity links'
 * resolved `value`, demonstrating that a link looks the same to the UI
 * regardless of how it was represented in the payload.
 */
export function ProductTable({ ctx, uc }: ProductTableProps) {
  const { items, isLoading, currentPage, pageSize, totalItems, onPageChange } =
    useDataLoading<
      Product,
      EntityRepositoryTag | ConfigurationRepositoryTag | EntityLinkResolverTag
    >({ uc, ctx });

  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  return (
    <div>
      {isLoading && <div>Loading…</div>}
      <table>
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>id</th>
            <th style={{ textAlign: 'left' }}>code</th>
            <th style={{ textAlign: 'left' }}>name</th>
            <th style={{ textAlign: 'left' }}>brand (embedded)</th>
            <th style={{ textAlign: 'left' }}>category (foreign key)</th>
          </tr>
        </thead>
        <tbody>
          {items.map(product => (
            <tr key={String(product.id ?? '')}>
              <td>{String(product.id ?? '')}</td>
              <td>{product.code}</td>
              <td>{product.name}</td>
              <td>{product.brand.value?.name ?? String(product.brand.id ?? '')}</td>
              <td>
                {product.category.value?.name ??
                  String(product.category.id ?? '')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div>
        <button
          type="button"
          disabled={currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
        >
          Previous
        </button>
        <span>
          {' '}
          Page {currentPage} of {totalPages} ({totalItems} items){' '}
        </span>
        <button
          type="button"
          disabled={currentPage >= totalPages}
          onClick={() => onPageChange(currentPage + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
