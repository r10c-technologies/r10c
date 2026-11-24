'use client';

import { type EntityRepositoryTag, loadUCFactory } from '@entifix/business';
import type {
  Entity,
  EntityFieldDescriptor,
  EntityLinkSource,
} from '@entifix/core';
import {
  EntityLinkMultiInput,
  type ReferenceLabelLookup,
  ReferenceLabelsProvider,
  useReferenceLabels,
  useTranslateKey,
} from '@entifix/react-controls';
import { entityQueryScope, useDataLoading } from '@entifix/react-integration';
import { UNIVERSAL_DEVICE_MODEL } from '@r10c/business-ts-catalog-contracts';
import { DeviceModel } from '@r10c/business-ts-catalog-reference';
import { type ReactNode, useId, useMemo } from 'react';

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

/** The entity key a fitted id names, as `ProductSpecification` declares it. */
const DEVICE_MODEL = 'catalog-reference:device-model';

/**
 * Names the one fitted id that is no record. `universal` is a rule rather than
 * a `DeviceModel` row, so the host's registry, which reads names from the
 * target's repository, finds nothing for it. This answers it before the
 * registry is asked, and leaves every other id to it. The host mounts it
 * inside its reference-label host, as it lists this shell's registrations.
 */
export function UniversalFitLabels({ children }: { children: ReactNode }) {
  const outer = useReferenceLabels();
  const translateKey = useTranslateKey();
  const universal = translateKey(
    'r10c:marketplaceAdmin.wizard.productSetup.fits.universalShort',
  );
  const lookup = useMemo<ReferenceLabelLookup>(
    () => ({
      label: (entityKey, id) =>
        entityKey === DEVICE_MODEL && id === UNIVERSAL_DEVICE_MODEL
          ? { status: 'named', label: universal }
          : outer.label(entityKey, id),
      ...(outer.noun === undefined
        ? {}
        : { noun: entityKey => outer.noun?.(entityKey) }),
    }),
    [outer, universal],
  );
  return (
    <ReferenceLabelsProvider lookup={lookup}>
      {children}
    </ReferenceLabelsProvider>
  );
}

interface DeviceModelFitsFieldProps {
  /** `fitsDeviceModelIds`' descriptor: a list that references device models. */
  readonly descriptor: EntityFieldDescriptor;
  /** The draft's comma form of `fitsDeviceModelIds`. */
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** The device models' link source, active ones only. */
  readonly source: EntityLinkSource<Entity>;
  /** The id the field's label points at. */
  readonly id: string;
}

/**
 * Which phones a product fits: `universal`, or the models picked by name.
 *
 * The models are entifix's own list-of-references editor, the one any list
 * that names records gets. `universal` stays a box of its own beside it,
 * because it is no record a picker could offer. Ticking it clears every model
 * and hides the picker, and unticking it brings the picker back, empty. The
 * service refuses the combination too; this keeps the form from offering it.
 */
export function DeviceModelFitsField({
  descriptor,
  value,
  onChange,
  source,
  id,
}: DeviceModelFitsFieldProps) {
  const translateKey = useTranslateKey();
  const hintId = useId();
  const ids = readFitIds(value);
  const universal = ids.includes(UNIVERSAL_DEVICE_MODEL);
  const key = (leaf: string) =>
    `r10c:marketplaceAdmin.wizard.productSetup.fits.${leaf}`;
  // The metadata's label is the member's name; a person reads its catalog key.
  const named =
    descriptor.labelKey === undefined
      ? descriptor
      : { ...descriptor, label: translateKey(descriptor.labelKey) };

  return (
    <div className="flex flex-col gap-2xs">
      <label className="flex min-h-6 items-center gap-2xs">
        <input
          type="checkbox"
          className="size-6"
          checked={universal}
          aria-describedby={hintId}
          onChange={event =>
            onChange(
              toggleFit(ids, UNIVERSAL_DEVICE_MODEL, event.target.checked).join(
                ',',
              ),
            )
          }
        />
        <span>{translateKey(key('universal'))}</span>
      </label>
      <p id={hintId} className="text-sm">
        {translateKey(key('universalHint'))}
      </p>
      {universal ? null : (
        <EntityLinkMultiInput
          descriptor={named}
          value={value}
          source={source}
          id={id}
          onChange={onChange}
        />
      )}
    </div>
  );
}
