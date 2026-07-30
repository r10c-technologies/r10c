'use client';

import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import type {
  Entity,
  EntityFieldDescriptor,
  EntityLinkSource,
} from '@r10c/entifix-ts-core';

import { useT } from '../../../i18n';
import { Button } from '../../atoms/button';
import { EntityTable } from '../../organisms/entity-table';

export interface EntityLinkPickerProps<TTarget extends Entity> {
  /** The relation being set — its label names the dialog. */
  descriptor: EntityFieldDescriptor;
  source: EntityLinkSource<TTarget>;
  onSelect: (entity: TTarget) => void;
}

/**
 * The thorough half of setting a relation: the target entity's own table, with
 * its filters, sorting and paging, inside a dialog.
 *
 * It adds nothing to the table — that is the point. A picker that re-implemented
 * filtering would drift from the listing the user already knows, so this mounts
 * the same `EntityTable` and swaps navigation for selection through `onSelect`.
 * Everything it renders comes from `source.browse`, so it holds no fetch of its
 * own.
 */
export function EntityLinkPicker<TTarget extends Entity>({
  descriptor,
  source,
  onSelect,
}: EntityLinkPickerProps<TTarget>) {
  const t = useT();
  const { browse } = source;

  return (
    // The dialog element itself fills the viewport rather than wrapping a
    // `fixed` child in a `relative` box: a zero-sized dialog is invisible to
    // anything measuring it — assistive tech and Playwright alike — even with a
    // painted panel inside it.
    <Dialog
      open={browse.isOpen}
      onClose={browse.close}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-s"
    >
      {/* Backdrop and panel are separate so a click outside closes the dialog
          without the table's own clicks bubbling into it. */}
      <div aria-hidden className="fixed inset-0 bg-black/40" />
      <DialogPanel className="relative w-full max-w-4xl rounded-lg border border-border bg-surface p-s shadow-lg">
          <div className="flex items-center justify-between gap-s">
            <DialogTitle className="text-step-1 font-semibold text-content">
              {t('link.browseTitle', { field: descriptor.label })}
            </DialogTitle>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={browse.close}
            >
              {t('link.close')}
            </Button>
          </div>

          <EntityTable<TTarget>
            entityConstructor={source.entityConstructor}
            isLoading={browse.isLoading}
            error={browse.error}
            items={browse.items}
            totalItems={browse.totalItems}
            currentPage={browse.currentPage}
            pageSize={browse.pageSize}
            onPageChange={browse.onPageChange}
            onPageSizeChange={browse.onPageSizeChange}
            filtering={browse.filtering}
            sorting={browse.sorting}
            onFilteringChange={browse.onFilteringChange}
            onSortingChange={browse.onSortingChange}
            onSelect={onSelect}
            // Scoped so a picker's column personalization does not overwrite the
            // one the user set on the full listing of the same entity.
            preferencesKey={`link-picker:${descriptor.name}`}
          />
      </DialogPanel>
    </Dialog>
  );
}
