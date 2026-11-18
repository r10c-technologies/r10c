'use client';

import { type EntityRepositoryTag, loadUCFactory } from '@entifix/business';
import { useTranslateKey } from '@entifix/react-controls';
import { entityQueryScope, useDataLoading } from '@entifix/react-integration';
import { UNIVERSAL_DEVICE_MODEL } from '@r10c/business-ts-catalog-contracts';
import { DeviceModel } from '@r10c/business-ts-catalog-reference';
import { useId } from 'react';

import { useMarketplaceAdminAdapters } from './marketplace-admin-context';

/**
 * How many models the picker reads in one page. The operator's list is a few
 * dozen phones; a vocabulary past this wants a search box, not a bigger page.
 */
const MODEL_PAGE_SIZE = 200;

/** Splits the draft's comma form of a `scalarCollection` back into ids. */
export const readFitIds = (value: string): string[] =>
  value
    .split(',')
    .map(id => id.trim())
    .filter(id => id !== '');

/**
 * What ticking or clearing one box leaves: `universal` stands alone, so ticking
 * it clears every model, and ticking a model clears `universal`. The service
 * refuses the combination too; this keeps the form from offering it.
 */
export const toggleFit = (
  ids: readonly string[],
  id: string,
  checked: boolean,
): string[] => {
  if (!checked) return ids.filter(one => one !== id);
  if (id === UNIVERSAL_DEVICE_MODEL) return [UNIVERSAL_DEVICE_MODEL];
  return [...ids.filter(one => one !== UNIVERSAL_DEVICE_MODEL), id];
};

/**
 * The active device models, read through marketplace-service's own path — the
 * one legal way across the store boundary (ADR 0022). Also what turns the
 * stored ids back into names on the summary.
 */
export function useDeviceModels(): {
  readonly models: readonly DeviceModel[];
  readonly isLoading: boolean;
} {
  const { items, isLoading } = useDataLoading<DeviceModel, EntityRepositoryTag>(
    {
      uc: loadUCFactory<DeviceModel>(),
      ctx: useMarketplaceAdminAdapters().deviceModelRest,
      initialPageSize: MODEL_PAGE_SIZE,
      queryKey: entityQueryScope(DeviceModel),
    },
  );
  return { models: items, isLoading };
}

/** The names a list of fitted ids reads as, in the order the vendor ticked them. */
export function fitNames(
  ids: readonly string[],
  models: readonly DeviceModel[],
  universalLabel: string,
): string {
  return ids
    .map(id =>
      id === UNIVERSAL_DEVICE_MODEL
        ? universalLabel
        : (models.find(model => String(model.id) === id)?.name ?? id),
    )
    .join(', ');
}

interface DeviceModelFitPickerProps {
  /** The draft's comma form of `fitsDeviceModelIds`. */
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** The id the field's label points at. */
  readonly id: string;
}

/**
 * Which phones a product fits, as a box per model plus `universal` (plan 1.17).
 *
 * r10c's own control because entifix has none for a list of ids into another
 * record: a `scalarCollection` cannot declare `references`, so the generic form
 * would offer a text box of raw ids. A group of checkboxes rather than a
 * multi-select: a counter's list is a few dozen phones, every one visible at
 * once is faster to scan than a listbox, and each box is a native control.
 */
export function DeviceModelFitPicker({
  value,
  onChange,
  id,
}: DeviceModelFitPickerProps) {
  const translateKey = useTranslateKey();
  const hintId = useId();
  const { models, isLoading } = useDeviceModels();
  const ids = readFitIds(value);
  const key = (leaf: string) =>
    `r10c:marketplaceAdmin.wizard.productSetup.fits.${leaf}`;
  const active = models.filter(model => model.status === 'active');

  const box = (boxId: string, label: string, describedBy?: string) => (
    <label key={boxId} className="flex min-h-6 items-center gap-2xs">
      <input
        type="checkbox"
        className="size-6"
        checked={ids.includes(boxId)}
        aria-describedby={describedBy}
        onChange={event =>
          onChange(toggleFit(ids, boxId, event.target.checked).join(','))
        }
      />
      <span>{label}</span>
    </label>
  );

  return (
    <div
      id={id}
      role="group"
      aria-label={translateKey(
        'entity:product-specification.fields.fitsDeviceModelIds',
      )}
      className="flex flex-col gap-2xs"
    >
      {box(UNIVERSAL_DEVICE_MODEL, translateKey(key('universal')), hintId)}
      <p id={hintId} className="text-sm">
        {translateKey(key('universalHint'))}
      </p>
      {isLoading ? (
        <p>{translateKey(key('loading'))}</p>
      ) : active.length === 0 ? (
        <p>{translateKey(key('none'))}</p>
      ) : (
        active.map(model => box(String(model.id), model.name))
      )}
    </div>
  );
}
