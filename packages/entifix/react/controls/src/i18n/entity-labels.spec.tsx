import type { EntityFieldDescriptor } from '@r10c/entifix-ts-core';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  useEnumLabel,
  useErrorMessage,
  useLocalizedDescriptors,
} from './entity-labels';
import { I18nProvider } from './i18n-context';

function descriptor(
  overrides: Partial<EntityFieldDescriptor> = {},
): EntityFieldDescriptor {
  return {
    name: 'code',
    key: 'code',
    label: 'Code',
    type: 'string',
    sortable: true,
    filterable: true,
    order: 0,
    readonly: false,
    required: false,
    linkLabelProperty: 'name',
    linkSearchProperty: 'name',
    linkSerialization: 'id',
    resetOnClone: false,
    ...overrides,
  };
}

function Labels({ descriptors }: { descriptors: EntityFieldDescriptor[] }) {
  const localized = useLocalizedDescriptors(descriptors);
  return (
    <span data-testid="labels">{localized.map(d => d.label).join('|')}</span>
  );
}

function EnumValue({
  field,
  value,
}: {
  field: EntityFieldDescriptor;
  value: string;
}) {
  const enumLabel = useEnumLabel();
  return <span data-testid="value">{enumLabel(field, value)}</span>;
}

describe('useLocalizedDescriptors', () => {
  it('resolves a declared label key', () => {
    render(
      <I18nProvider locale="es">
        <Labels
          descriptors={[
            descriptor({
              labelKey: 'entity:product-specification.fields.code',
            }),
          ]}
        />
      </I18nProvider>,
    );

    expect(screen.getByTestId('labels')).toHaveTextContent('Código');
  });

  it('keeps the declared label when the member has no key', () => {
    render(
      <I18nProvider locale="es">
        <Labels descriptors={[descriptor()]} />
      </I18nProvider>,
    );

    expect(screen.getByTestId('labels')).toHaveTextContent('Code');
  });

  it('follows the active locale', () => {
    render(
      <I18nProvider locale="en">
        <Labels
          descriptors={[
            descriptor({
              labelKey: 'entity:product-specification.fields.code',
            }),
          ]}
        />
      </I18nProvider>,
    );

    expect(screen.getByTestId('labels')).toHaveTextContent('Code');
  });
});

describe('useEnumLabel', () => {
  it('reads a value through its declared vocabulary', () => {
    render(
      <I18nProvider locale="es">
        <EnumValue
          field={descriptor({
            type: 'enum',
            enumValues: ['admin', 'user'],
            enumLabelKey: 'entity:user-identity.values.role',
          })}
          value="admin"
        />
      </I18nProvider>,
    );

    expect(screen.getByTestId('value')).toHaveTextContent('Administrador');
  });

  it('falls back to the raw value when no vocabulary is declared', () => {
    render(
      <I18nProvider locale="es">
        <EnumValue
          field={descriptor({ type: 'enum', enumValues: ['admin'] })}
          value="admin"
        />
      </I18nProvider>,
    );

    expect(screen.getByTestId('value')).toHaveTextContent('admin');
  });
});

function Failure({
  error,
}: {
  error: { message: string; details?: Record<string, unknown> };
}) {
  const errorMessage = useErrorMessage();
  return <span data-testid="failure">{errorMessage(error)}</span>;
}

describe('useErrorMessage', () => {
  it('renders the code the service answered with', () => {
    render(
      <I18nProvider locale="es">
        <Failure
          error={{
            message: 'invalid query',
            details: { code: 'invalidQuery' },
          }}
        />
      </I18nProvider>,
    );

    expect(screen.getByTestId('failure')).toHaveTextContent(
      'La consulta no es válida.',
    );
  });

  // A failure raised client-side, or one from a service that predates the
  // vocabulary, still has to read as something.
  it('falls back to the message when there is no code', () => {
    render(
      <I18nProvider locale="es">
        <Failure error={{ message: 'socket hang up' }} />
      </I18nProvider>,
    );

    expect(screen.getByTestId('failure')).toHaveTextContent('socket hang up');
  });
});
