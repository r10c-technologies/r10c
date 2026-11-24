import { useT } from '@entifix/react-controls';
import { clientCatalog } from '@r10c/i18n-catalog';
import { render, screen } from '@testing-library/react';
import React from 'react';

import { Providers } from '../src/app/providers';

/**
 * The pages themselves are server components now, and this jsdom + RTL setup
 * cannot render one — so they are covered by `marketplace-app-e2e` instead, and
 * what is worth unit-testing here is the app's only client boundary.
 *
 * `Providers` is where the locale crosses from the server into client code. If
 * it were wired wrong the page would still prerender perfectly and every
 * interactive control would silently speak the wrong language. The copy it
 * installs is the subset its layout hands it (#566).
 */
const catalogFor = (locale: 'en' | 'es') =>
  clientCatalog(locale, ['controls', 'r10c.storefront.missing']);

function Copy() {
  const t = useT('controls');
  return <span>{t('table.filters')}</span>;
}

describe('Providers', () => {
  it('hands the locale it was given to the client tree', () => {
    render(
      <Providers locale="en" catalog={catalogFor('en')}>
        <Copy />
      </Providers>,
    );

    expect(screen.getByText('Filters')).toBeInTheDocument();
  });

  it('renders in Spanish when that is the locale', () => {
    render(
      <Providers locale="es" catalog={catalogFor('es')}>
        <Copy />
      </Providers>,
    );

    expect(screen.getByText('Filtros')).toBeInTheDocument();
  });
});
