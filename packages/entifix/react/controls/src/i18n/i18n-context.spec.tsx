import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { I18nProvider, useFormatters, useLocale, useT } from './i18n-context';

function Probe({ ns }: { ns?: 'controls' | 'entity' }) {
  const t = useT(ns);
  const locale = useLocale();
  const formatters = useFormatters();

  return (
    <dl>
      <dd data-testid="locale">{locale}</dd>
      <dd data-testid="translated">
        {ns === 'entity' ? t('product-specification.label') : t('table.open')}
      </dd>
      <dd data-testid="number">{formatters.number(1234.5)}</dd>
    </dl>
  );
}

describe('I18nProvider', () => {
  it('binds the locale it is given to the subtree', () => {
    render(
      <I18nProvider locale="en">
        <Probe />
      </I18nProvider>,
    );

    expect(screen.getByTestId('locale')).toHaveTextContent('en');
    expect(screen.getByTestId('translated')).toHaveTextContent('Open');
    expect(screen.getByTestId('number')).toHaveTextContent(
      new Intl.NumberFormat('en').format(1234.5),
    );
  });

  it('resolves a non-default namespace', () => {
    render(
      <I18nProvider locale="es">
        <Probe ns="entity" />
      </I18nProvider>,
    );

    expect(screen.getByTestId('translated')).toHaveTextContent('Producto');
  });

  it('keeps two subtrees independent, so one render cannot leak into another', () => {
    render(
      <>
        <I18nProvider locale="es">
          <Probe />
        </I18nProvider>
        <I18nProvider locale="en">
          <Probe />
        </I18nProvider>
      </>,
    );

    const translated = screen.getAllByTestId('translated');
    expect(translated[0]).toHaveTextContent('Abrir');
    expect(translated[1]).toHaveTextContent('Open');
  });

  it('renders the fleet default when nobody mounted a provider', () => {
    render(<Probe />);

    expect(screen.getByTestId('locale')).toHaveTextContent('es');
    expect(screen.getByTestId('translated')).toHaveTextContent('Abrir');
    expect(screen.getByTestId('number')).toHaveTextContent(
      new Intl.NumberFormat('es').format(1234.5),
    );
  });
});
