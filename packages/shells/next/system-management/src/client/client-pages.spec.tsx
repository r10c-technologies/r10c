import { Configuration } from '@r10c/business-ts-configuration';
import { EntifixQueryProvider } from '@r10c/entifix-react-integration';
import {
  ConfigurationRepositoryTag,
  EntityRepositoryTag,
} from '@r10c/entifix-ts-business';
import { EntifixConnError, type Entity } from '@r10c/entifix-ts-core';
import {
  makeInMemoryEntityRepository,
  makeStubConfigurationClient,
} from '@r10c/entifix-ts-testing-unit';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Context } from 'effect';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SystemManagementAdapters } from './client-types.js';
import { ConfigurationListClientPage } from './configuration-list/configuration-list-client-page.js';
import { ConfigurationSingleViewClientPage } from './configuration-single-view/configuration-single-view-client-page.js';
import { SystemManagementProvider } from './system-management-context.js';

// The pages read the route through `next/navigation`, which only exists inside a
// running Next app; the slug is the one input a test needs to vary.
const push = vi.fn();
let slug = 'new';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useParams: () => ({ slug }),
}));

const makeRow = (
  id: string,
  key: string,
  value: string,
  isSecret = false,
): Configuration => {
  const row = new Configuration();
  row.id = id;
  row.service = 'auth-service';
  row.groupName = 'mongo';
  row.key = key;
  row.value = value;
  row.isSecret = isSecret;
  return row;
};

let repository: ReturnType<typeof makeInMemoryEntityRepository>;

const adapters = (): SystemManagementAdapters => ({
  configurationRest: Context.make(EntityRepositoryTag, repository),
  configurationStore: Context.make(
    ConfigurationRepositoryTag,
    makeStubConfigurationClient(),
  ),
});

const renderPage = (page: ReactElement) =>
  render(
    <EntifixQueryProvider>
      <SystemManagementProvider adapters={adapters()}>
        {page}
      </SystemManagementProvider>
    </EntifixQueryProvider>,
  );

beforeEach(() => {
  push.mockClear();
  slug = 'new';
  repository = makeInMemoryEntityRepository([
    makeRow('c-1', 'db', 'auth'),
    // A secret arrives from the service with its value blanked, which is the
    // shape the form has to cope with.
    makeRow('c-2', 'uri', '', true),
  ] as Entity[]);
});

describe('ConfigurationListClientPage', () => {
  it('lists the rows from the adapters it was given', async () => {
    renderPage(<ConfigurationListClientPage />);

    await waitFor(() =>
      expect(screen.getAllByText('db').length).toBeGreaterThan(0),
    );
  });

  it('takes a caller-supplied link builder, so a workspace tab can reroute rows', async () => {
    renderPage(
      <ConfigurationListClientPage hrefFor={id => `#${String(id)}`} />,
    );

    await waitFor(() =>
      expect(screen.getAllByText('db').length).toBeGreaterThan(0),
    );
    expect(document.querySelector('a[href="#c-1"]')).not.toBeNull();
  });
});

describe('ConfigurationSingleViewClientPage', () => {
  it('loads the row named by the route slug', async () => {
    slug = 'c-1';

    renderPage(<ConfigurationSingleViewClientPage />);

    await waitFor(() =>
      expect(screen.getByDisplayValue('auth')).toBeInTheDocument(),
    );
  });

  it('opens empty for the create slug', async () => {
    renderPage(<ConfigurationSingleViewClientPage />);

    await waitFor(() =>
      expect(screen.getByLabelText(/Clave|Key/i)).toHaveValue(''),
    );
  });

  it('prefers the slug prop over the route, which is how a tab hosts it', async () => {
    slug = 'new';

    renderPage(<ConfigurationSingleViewClientPage slug="c-1" />);

    await waitFor(() =>
      expect(screen.getByDisplayValue('auth')).toBeInTheDocument(),
    );
  });

  it('saves and calls back instead of navigating when hosted in a tab', async () => {
    slug = 'c-1';
    const onSaved = vi.fn();

    renderPage(
      <ConfigurationSingleViewClientPage slug="c-1" onSaved={onSaved} />,
    );

    await waitFor(() =>
      expect(screen.getByDisplayValue('auth')).toBeInTheDocument(),
    );
    await userEvent.click(
      screen.getByRole('button', { name: /Guardar|Save/i }),
    );

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(push).not.toHaveBeenCalled();
  });

  it('navigates back to the list after saving a routed page', async () => {
    slug = 'c-1';

    renderPage(<ConfigurationSingleViewClientPage />);

    await waitFor(() =>
      expect(screen.getByDisplayValue('auth')).toBeInTheDocument(),
    );
    await userEvent.click(
      screen.getByRole('button', { name: /Guardar|Save/i }),
    );

    // Prefixed: the page navigates through `useLocaleHref`, and with no i18n
    // provider around the render that resolves to `DEFAULT_LOCALE`.
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith('/es/system/configuration'),
    );
  });

  it('deletes an existing row and calls back', async () => {
    slug = 'c-1';
    const onDeleted = vi.fn();

    renderPage(
      <ConfigurationSingleViewClientPage slug="c-1" onDeleted={onDeleted} />,
    );

    await waitFor(() =>
      expect(screen.getByDisplayValue('auth')).toBeInTheDocument(),
    );
    await userEvent.click(
      screen.getByRole('button', { name: /Eliminar|Delete/i }),
    );

    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
  });

  it('navigates back to the list after deleting a routed page', async () => {
    slug = 'c-1';

    renderPage(<ConfigurationSingleViewClientPage />);

    await waitFor(() =>
      expect(screen.getByDisplayValue('auth')).toBeInTheDocument(),
    );
    await userEvent.click(
      screen.getByRole('button', { name: /Eliminar|Delete/i }),
    );

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith('/es/system/configuration'),
    );
  });

  it('offers no delete for a record that does not exist yet', async () => {
    renderPage(<ConfigurationSingleViewClientPage />);

    await waitFor(() =>
      expect(screen.getByLabelText(/Clave|Key/i)).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole('button', { name: /Eliminar|Delete/i }),
    ).toBeNull();
  });
});

describe('a secret value', () => {
  it('renders as a masked field that starts blank, never showing the stored value', async () => {
    slug = 'c-2';

    renderPage(<ConfigurationSingleViewClientPage slug="c-2" />);

    await waitFor(() =>
      expect(screen.getByDisplayValue('uri')).toBeInTheDocument(),
    );

    const value = document.querySelector('input[type="password"]');
    expect(value).not.toBeNull();
    expect((value as HTMLInputElement).value).toBe('');
  });

  it('submits nothing for the value when left blank, so the credential survives', async () => {
    slug = 'c-2';

    renderPage(<ConfigurationSingleViewClientPage slug="c-2" />);
    await waitFor(() =>
      expect(screen.getByDisplayValue('uri')).toBeInTheDocument(),
    );

    await userEvent.click(
      screen.getByRole('button', { name: /Guardar|Save/i }),
    );

    await waitFor(() => expect(push).toHaveBeenCalled());
    const saved = repository.items.find(item => item.id === 'c-2') as
      Configuration | undefined;
    // Absent rather than an empty string: the service reads absence as
    // "unchanged" and would read `''` as an intentional blanking.
    expect(saved?.value).toBeUndefined();
  });

  it('submits a replacement when one is typed', async () => {
    slug = 'c-2';

    renderPage(<ConfigurationSingleViewClientPage slug="c-2" />);
    await waitFor(() =>
      expect(screen.getByDisplayValue('uri')).toBeInTheDocument(),
    );

    const value = document.querySelector(
      'input[type="password"]',
    ) as HTMLInputElement;
    await userEvent.type(value, 'new-secret');
    await userEvent.click(
      screen.getByRole('button', { name: /Guardar|Save/i }),
    );

    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(
      (
        repository.items.find(item => item.id === 'c-2') as
          Configuration | undefined
      )?.value,
    ).toBe('new-secret');
  });
});

describe('a write that fails', () => {
  it('stays on the form rather than reporting success', async () => {
    slug = 'c-1';
    const onSaved = vi.fn();

    renderPage(
      <ConfigurationSingleViewClientPage slug="c-1" onSaved={onSaved} />,
    );
    await waitFor(() =>
      expect(screen.getByDisplayValue('auth')).toBeInTheDocument(),
    );

    // Armed after the record loads, so the failure lands on the save rather than
    // being consumed by the initial read.
    repository.failNext(new EntifixConnError('service unreachable', undefined));
    await userEvent.click(
      screen.getByRole('button', { name: /Guardar|Save/i }),
    );

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /Guardar|Save/i }),
      ).toBeEnabled(),
    );
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe('a delete that fails', () => {
  it('does not report the record as deleted', async () => {
    slug = 'c-1';
    const onDeleted = vi.fn();

    renderPage(
      <ConfigurationSingleViewClientPage slug="c-1" onDeleted={onDeleted} />,
    );
    await waitFor(() =>
      expect(screen.getByDisplayValue('auth')).toBeInTheDocument(),
    );

    repository.failNext(new EntifixConnError('service unreachable', undefined));
    await userEvent.click(
      screen.getByRole('button', { name: /Eliminar|Delete/i }),
    );

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /Eliminar|Delete/i }),
      ).toBeEnabled(),
    );
    expect(onDeleted).not.toHaveBeenCalled();
  });
});

describe('SystemManagementProvider', () => {
  it('builds the real REST adapters when a host provides none', () => {
    // The default path — a host mounts the provider without arguments, and the
    // adapters come from `createClientAdapters`.
    expect(() =>
      render(
        <EntifixQueryProvider>
          <SystemManagementProvider>
            <div />
          </SystemManagementProvider>
        </EntifixQueryProvider>,
      ),
    ).not.toThrow();
  });

  it('refuses to serve adapters outside a provider', () => {
    // A page rendered without the provider would otherwise fail much later, with
    // an error about a missing Effect service rather than a missing provider.
    expect(() => render(<ConfigurationListClientPage />)).toThrow(
      /SystemManagementProvider/,
    );
  });
});
