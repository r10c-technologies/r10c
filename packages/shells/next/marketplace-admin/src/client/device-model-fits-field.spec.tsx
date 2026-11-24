import {
  type Entity,
  type EntityFieldDescriptor,
  type EntityLinkSource,
} from '@entifix/core';
import {
  type ReferenceLabelLookup,
  ReferenceLabelsProvider,
  useReferenceLabels,
} from '@entifix/react-controls';
import { render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  DeviceModelFitsField,
  UniversalFitLabels,
} from './device-model-fits.js';

const MODEL = 'catalog-reference:device-model';

describe('UniversalFitLabels', () => {
  const wrapWith =
    (outer: ReferenceLabelLookup) =>
    ({ children }: { children: ReactNode }) => (
      <ReferenceLabelsProvider lookup={outer}>
        <UniversalFitLabels>{children}</UniversalFitLabels>
      </ReferenceLabelsProvider>
    );

  it('names universal itself, and asks the registry for every other id', () => {
    const outer: ReferenceLabelLookup = {
      label: vi.fn(() => ({ status: 'named', label: 'Galaxy A15' }) as const),
    };
    const { result } = renderHook(() => useReferenceLabels(), {
      wrapper: wrapWith(outer),
    });
    expect(result.current.label(MODEL, 'universal')).toEqual({
      status: 'named',
      label: 'Universal',
    });
    expect(result.current.label(MODEL, 'dm-1')).toEqual({
      status: 'named',
      label: 'Galaxy A15',
    });
    expect(result.current.label('other:thing', 'universal')).toEqual({
      status: 'named',
      label: 'Galaxy A15',
    });
    // A registry with no nouns stays without one.
    expect(result.current.noun).toBeUndefined();
  });

  it('keeps the registry’s nouns', () => {
    const outer: ReferenceLabelLookup = {
      label: () => ({ status: 'notFound' }),
      noun: () => ({ name: 'Modelo', key: 'device-model' }),
    };
    const { result } = renderHook(() => useReferenceLabels(), {
      wrapper: wrapWith(outer),
    });
    expect(result.current.noun?.(MODEL)).toEqual({
      name: 'Modelo',
      key: 'device-model',
    });
  });
});

describe('DeviceModelFitsField', () => {
  const descriptor = {
    name: 'fitsDeviceModelIds',
    key: 'fitsDeviceModelIds',
    label: 'Fits',
    type: 'scalarCollection',
    sortable: false,
    filterable: false,
    order: 0,
    readonly: false,
    required: false,
    resetOnClone: false,
    references: { entity: MODEL },
  } as unknown as EntityFieldDescriptor;

  const source = {
    entityConstructor: class {},
    labelOf: () => '',
    selected: { isLoading: false },
    quick: { term: '', setTerm: vi.fn(), options: [], isLoading: false },
    browse: {
      items: [],
      totalItems: 0,
      currentPage: 1,
      pageSize: 10,
      isLoading: false,
      onPageChange: vi.fn(),
      onPageSizeChange: vi.fn(),
      onFilteringChange: vi.fn(),
      onSortingChange: vi.fn(),
      isOpen: false,
      open: vi.fn(),
      close: vi.fn(),
    },
  } as unknown as EntityLinkSource<Entity>;

  it('names the picker from the metadata when there is no catalog key', async () => {
    const onChange = vi.fn();
    render(
      <DeviceModelFitsField
        descriptor={descriptor}
        source={source}
        id="fits"
        value=""
        onChange={onChange}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Ver sugerencias de Fits' }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: /^Universal/ }));
    expect(onChange).toHaveBeenCalledWith('universal');
  });
});
