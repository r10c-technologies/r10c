import {
  type Entity,
  EntityCollectionLink,
  type EntityFieldDescriptor,
  type EntityId,
  EntityLink,
  type MetaAccessorType,
} from '@r10c/entifix-ts-core';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CellValue } from './cell-value.js';

const EMPTY = '—';

class Brand implements Entity {
  constructor(
    public id: EntityId = undefined,
    public name = '',
  ) {}
}

const descriptor = (
  type: MetaAccessorType,
  linkLabelProperty = 'name',
): EntityFieldDescriptor => ({
  name: 'field',
  key: 'field',
  label: 'Field',
  type,
  sortable: true,
  filterable: true,
  order: 0,
  linkLabelProperty,
});

const renderCell = (value: unknown, type: MetaAccessorType, labelProperty?: string) =>
  render(<CellValue value={value} descriptor={descriptor(type, labelProperty)} />);

describe('CellValue', () => {
  // An absent value renders as a dash rather than nothing, so an empty cell
  // reads as intentional instead of looking like a rendering bug.
  it.each([
    ['undefined', undefined],
    ['null', null],
  ])('renders a placeholder for %s', (_label, value) => {
    renderCell(value, 'string');

    expect(screen.getByText(EMPTY)).toBeInTheDocument();
  });

  it('renders a placeholder for a value that formats to an empty string', () => {
    renderCell('', 'string');

    expect(screen.getByText(EMPTY)).toBeInTheDocument();
  });

  it.each([
    ['a string', 'Acme', 'string', 'Acme'],
    ['an id', 'w-1', 'id', 'w-1'],
    ['an enum', 'active', 'enum', 'active'],
  ] as const)('renders %s verbatim', (_label, value, type, expected) => {
    renderCell(value, type);

    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  describe('booleans', () => {
    // Rendering `true`/`false` would leak the wire representation into the UI.
    it.each([
      [true, 'Yes'],
      [false, 'No'],
    ])('renders %s as %s', (value, expected) => {
      renderCell(value, 'boolean');

      expect(screen.getByText(expected)).toBeInTheDocument();
    });
  });

  describe('numbers', () => {
    it('formats a number for the locale', () => {
      renderCell(1234567, 'number');

      expect(screen.getByText((1234567).toLocaleString())).toBeInTheDocument();
    });

    it('renders zero rather than treating it as absent', () => {
      renderCell(0, 'number');

      expect(screen.getByText('0')).toBeInTheDocument();
    });

    it('falls back to the raw text when the value is not a number', () => {
      renderCell('not-a-number', 'number');

      expect(screen.getByText('not-a-number')).toBeInTheDocument();
    });
  });

  describe('dates', () => {
    const date = new Date('2026-07-20T00:00:00.000Z');

    it('formats a Date for the locale', () => {
      renderCell(date, 'date');

      expect(screen.getByText(date.toLocaleDateString())).toBeInTheDocument();
    });

    // Dates arrive as ISO strings over the wire, so the cell has to parse.
    it('parses an ISO string', () => {
      renderCell('2026-07-20T00:00:00.000Z', 'date');

      expect(screen.getByText(date.toLocaleDateString())).toBeInTheDocument();
    });

    it('falls back to the raw text for an unparseable date', () => {
      renderCell('not-a-date', 'date');

      expect(screen.getByText('not-a-date')).toBeInTheDocument();
    });
  });

  describe('to-one links', () => {
    // The same cell markup covers both shapes a relation can arrive in: a
    // loaded target reads as its label, an unresolved one as its foreign key.
    it('renders a loaded target’s label', () => {
      renderCell(new EntityLink(Brand, { value: new Brand('b-1', 'Acme') }), 'link');

      expect(screen.getByText('Acme')).toBeInTheDocument();
    });

    it('renders the foreign key when the target is not loaded', () => {
      renderCell(new EntityLink(Brand, { id: 'b-1' }), 'link');

      expect(screen.getByText('b-1')).toBeInTheDocument();
    });

    it('honours a custom label property', () => {
      renderCell(
        new EntityLink(Brand, { value: new Brand('b-1', 'Acme') }),
        'link',
        'id',
      );

      expect(screen.getByText('b-1')).toBeInTheDocument();
    });

    it('falls back to the foreign key when the label property is absent', () => {
      renderCell(
        new EntityLink(Brand, { value: new Brand('b-1', 'Acme') }),
        'link',
        'missing',
      );

      expect(screen.getByText('b-1')).toBeInTheDocument();
    });

    it('renders a placeholder for an empty link', () => {
      renderCell(new EntityLink(Brand), 'link');

      expect(screen.getByText(EMPTY)).toBeInTheDocument();
    });

    it('falls back to the raw text when the value is not a link at all', () => {
      renderCell('b-1', 'link');

      expect(screen.getByText('b-1')).toBeInTheDocument();
    });
  });

  describe('to-many links', () => {
    it('joins loaded targets by their labels', () => {
      renderCell(
        new EntityCollectionLink(Brand, {
          values: [new Brand('b-1', 'Acme'), new Brand('b-2', 'Globex')],
        }),
        'linkCollection',
      );

      expect(screen.getByText('Acme, Globex')).toBeInTheDocument();
    });

    it('joins foreign keys when the targets are not loaded', () => {
      renderCell(
        new EntityCollectionLink(Brand, { ids: ['b-1', 'b-2'] }),
        'linkCollection',
      );

      expect(screen.getByText('b-1, b-2')).toBeInTheDocument();
    });

    it('falls back to a loaded target’s id when it carries no label', () => {
      renderCell(
        new EntityCollectionLink(Brand, { values: [new Brand('b-1', '')] }),
        'linkCollection',
        'missing',
      );

      expect(screen.getByText('b-1')).toBeInTheDocument();
    });

    it('falls back to the positional id when a loaded target has neither', () => {
      const link = new EntityCollectionLink(Brand, { ids: ['b-9'] });
      link.setValues([new Brand(undefined, '')]);
      link.setIds(['b-9']);

      render(
        <CellValue value={link} descriptor={descriptor('linkCollection', 'missing')} />,
      );

      expect(screen.getByText('b-9')).toBeInTheDocument();
    });

    // A loaded target with neither a label, an id, nor a positional id has
    // nothing to render — the cell falls all the way back to the placeholder
    // rather than printing "undefined".
    it('renders a placeholder for a loaded target with nothing to show', () => {
      const link = new EntityCollectionLink(Brand);
      link.setValues([new Brand(undefined, '')]);

      render(
        <CellValue value={link} descriptor={descriptor('linkCollection', 'missing')} />,
      );

      expect(screen.getByText(EMPTY)).toBeInTheDocument();
    });

    it('renders a placeholder for an empty collection link', () => {
      renderCell(new EntityCollectionLink(Brand), 'linkCollection');

      expect(screen.getByText(EMPTY)).toBeInTheDocument();
    });

    it('falls back to the raw text when the value is not a collection link', () => {
      renderCell('b-1', 'linkCollection');

      expect(screen.getByText('b-1')).toBeInTheDocument();
    });
  });
});
