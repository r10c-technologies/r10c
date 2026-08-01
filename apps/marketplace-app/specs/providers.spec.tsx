import { useT } from '@r10c/entifix-react-controls';
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
 * interactive control would silently speak the wrong language.
 */
function Copy() {
  const t = useT('controls');
  return <span>{t('table.open')}</span>;
}

describe('Providers', () => {
  it('hands the locale it was given to the client tree', () => {
    render(
      <Providers locale="en">
        <Copy />
      </Providers>,
    );

    expect(screen.getByText('Open')).toBeInTheDocument();
  });

  it('renders in Spanish when that is the locale', () => {
    render(
      <Providers locale="es">
        <Copy />
      </Providers>,
    );

    expect(screen.getByText('Abrir')).toBeInTheDocument();
  });
});
