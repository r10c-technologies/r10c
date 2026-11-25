import 'fake-indexeddb/auto';

import { assertWizardDefinition } from '@entifix/core';
import { useDraftsState } from '@entifix/next-shell';
import { EntifixQueryProvider } from '@entifix/react-integration';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createClientAdapters } from './adapters/create-client-adapters.js';
import {
  CATALOG_IMPORT_WIZARD,
  CatalogImportWizard,
  columnLabel,
  isImportable,
  readSheetOf,
  sheetLocaleOf,
} from './catalog-import-wizard.js';
import type {
  CatalogImportOutcome,
  CatalogImportPort,
  ImportTable,
} from './client-types.js';
import { MarketplaceAdminAdaptersProvider } from './marketplace-admin-context/marketplace-admin-context.js';

let search = new URLSearchParams();
const push = vi.fn((url: string) => {
  search = new URLSearchParams(new URL(url, 'http://localhost').search);
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: push }),
  usePathname: () => '/es/wizards/import-catalog',
  useSelectedLayoutSegments: () => ['wizards', 'import-catalog'],
  useSearchParams: () => search,
  useParams: () => ({}),
}));

const SHEET: ImportTable = [
  ['Nombre', 'Precio', 'Marca'],
  ['Tornillo', '1.50', 'Truper'],
  ['Clavo', 'gratis', ''],
];

/** The sheet the fake reads, or `unreadable` for a file it cannot. */
let table: ImportTable | 'unreadable' = SHEET;
let outcome: CatalogImportOutcome = { ok: true, id: 'import-1' };
const submitted: { key: string; payload: unknown }[] = [];

const port: CatalogImportPort = {
  readTable: () =>
    table === 'unreadable'
      ? Promise.reject(new TypeError('not a sheet'))
      : Promise.resolve(table),
  references: () =>
    Promise.resolve({
      brands: [{ id: 'b-1', name: 'Truper' }],
      categories: [],
      deviceModels: [],
    }),
  submit: (key, payload) => {
    submitted.push({ key, payload });
    return Promise.resolve(outcome);
  },
};

const renderWizard = (
  props: { step?: string; onFinished?: (r: { id: string }) => void } = {},
) =>
  render(
    <EntifixQueryProvider>
      <MarketplaceAdminAdaptersProvider
        adapters={{ ...createClientAdapters(), catalogImport: port }}
      >
        <CatalogImportWizard {...props} />
      </MarketplaceAdminAdaptersProvider>
    </EntifixQueryProvider>,
  );

const click = async (name: string | RegExp) => {
  await userEvent.click(await screen.findByRole('button', { name }));
};

const upload = async () => {
  await userEvent.upload(
    await screen.findByLabelText('Hoja del catálogo'),
    new File(['x'], 'catalogo.csv', { type: 'text/csv' }),
  );
};

beforeEach(() => {
  table = SHEET;
  outcome = { ok: true, id: 'import-1' };
  submitted.length = 0;
  push.mockClear();
  search = new URLSearchParams();
  useDraftsState.setState({ drafts: {} });
  vi.spyOn(useDraftsState.persist, 'rehydrate').mockResolvedValue(undefined);
});

afterEach(() => {
  useDraftsState.setState({ drafts: {} });
});

describe('the definition', () => {
  it('is three steps ending in a review', () => {
    expect(() => assertWizardDefinition(CATALOG_IMPORT_WIZARD)).not.toThrow();
    expect(CATALOG_IMPORT_WIZARD.steps.map(step => step.kind)).toEqual([
      'choice',
      'form',
      'summary',
    ]);
  });

  it('reads a sheet only once one was kept, and imports one with a row', () => {
    const none = readSheetOf({});
    const kept = readSheetOf({
      fileName: 'a.csv',
      key: 'k',
      rows: [{ rowNumber: 2 }],
      problems: [],
    });

    expect(isImportable(none)).toBe(false);
    expect(isImportable(kept)).toBe(true);
    expect(
      isImportable({ ...kept, problems: [{ rowNumber: 1, code: 'x' }] }),
    ).toBe(false);
    expect(columnLabel({ price: 'Precio' } as never, 'price')).toBe('Precio');
    expect(columnLabel({} as never, undefined)).toBe('');
    expect([
      sheetLocaleOf('en'),
      sheetLocaleOf('es'),
      sheetLocaleOf('fr'),
    ]).toEqual(['en', 'es', 'es']);
  });
});

describe('importing a sheet', () => {
  it('reads it, shows each refused row, and submits the rest under one key', async () => {
    renderWizard();

    await click(/Publicados/);
    await click('Continuar');
    await upload();
    expect(await screen.findByTestId('catalog-import-read')).toHaveTextContent(
      'catalogo.csv: 1 filas listas, 1 con problemas.',
    );
    await click('Continuar');

    expect(await screen.findByTestId('catalog-import-ready')).toHaveTextContent(
      'Filas que se importarán: 1',
    );
    expect(screen.getByTestId('catalog-import-mode')).toHaveTextContent(
      'Publicados',
    );
    const rows = within(screen.getByRole('table')).getAllByRole('row');
    expect(rows[1]).toHaveTextContent(/3.*Precio.*no se pudo leer/);

    await click(/Finalizar|Crear|Importar/);

    expect(submitted).toEqual([
      {
        key: expect.any(String),
        payload: {
          fileName: 'catalogo.csv',
          mode: 'publish',
          rows: [
            expect.objectContaining({
              rowNumber: 2,
              name: 'Tornillo',
              brandId: 'b-1',
              amount: 150,
            }),
          ],
        },
      },
    ]);
    expect(push).toHaveBeenCalledWith('/es/catalog/catalog-import/import-1');
  });

  it('hands the record to a host that says where to go', async () => {
    const onFinished = vi.fn();
    table = [
      ['Nombre', 'Precio'],
      ['Tornillo', '1'],
    ];
    renderWizard({ onFinished });

    await click('Continuar');
    await upload();
    await click('Continuar');
    expect(await screen.findByTestId('catalog-import-ready')).toBeVisible();
    expect(screen.queryByTestId('catalog-import-rejected')).toBeNull();
    await click(/Finalizar|Crear|Importar/);

    expect(onFinished).toHaveBeenCalledWith({ id: 'import-1' });
    expect((submitted[0]?.payload as { mode: string }).mode).toBe('draft');
  });

  it('names a refusal and keeps the review open', async () => {
    outcome = { ok: false, code: 'importTooLarge' };
    renderWizard();

    await click('Continuar');
    await upload();
    await click('Continuar');
    await click(/Finalizar|Crear|Importar/);

    expect(
      await screen.findByTestId('catalog-import-failed'),
    ).toHaveTextContent(/no se completó.*más filas/);
    expect(push).not.toHaveBeenCalledWith(
      expect.stringContaining('/catalog/catalog-import/'),
    );
  });
});

describe('a sheet that cannot be imported', () => {
  it('will not move on without a sheet that has a row', async () => {
    renderWizard();

    await click('Continuar');
    fireEvent.change(await screen.findByLabelText('Hoja del catálogo'), {
      target: { files: [] },
    });
    await click('Continuar');

    expect(
      await screen.findByText(/al menos un producto que se pueda importar/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Hoja del catálogo')).toBeInTheDocument();
  });

  it('says a file it could not read was not read', async () => {
    table = 'unreadable';
    renderWizard();

    await click('Continuar');
    await upload();

    expect(
      await screen.findByText(/No se pudo leer este archivo/),
    ).toBeInTheDocument();
  });

  it('reports what is wrong with the sheet as a whole', async () => {
    table = [
      ['Nombre', 'Precio', 'Color'],
      ['Tornillo', '1', 'rojo'],
    ];
    renderWizard({ step: 'preview' });

    await click('Continuar');
    await upload();

    expect(
      await screen.findByTestId('catalog-import-sheet-problems'),
    ).toHaveTextContent(/columna que no conocemos/);
    await click('Continuar');
    expect(
      await screen.findByText(/al menos un producto que se pueda importar/),
    ).toBeInTheDocument();
  });
});

describe('moving back', () => {
  it('returns a step with Back, and to a walked step from the stepper', async () => {
    renderWizard();

    await click('Continuar');
    await click('Atrás');
    expect(await screen.findByText(/Cómo deben quedar/)).toBeInTheDocument();

    await click('Continuar');
    await click('Volver a Modo');
    expect(await screen.findByText(/Cómo deben quedar/)).toBeInTheDocument();
  });
});
