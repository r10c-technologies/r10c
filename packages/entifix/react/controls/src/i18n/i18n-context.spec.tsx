import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { I18nProvider } from '../i18next';
import { registerFallbackCatalog } from './fallback-catalogs';
import { useFormatters, useLocale, useT } from './i18n-context';
import { installSpecCatalogs } from './spec-support/catalogs';

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

installSpecCatalogs();

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

describe('the no-provider fallback', () => {
  function Bare({ ns, k, params }: { ns?: string; k: string; params?: Record<string, unknown> }) {
    const t = useT(ns);
    return <span data-testid="out">{t(k, params)}</span>;
  }

  it('resolves this package’s own copy, so a control speaks with no setup', () => {
    render(<Bare k="table.open" />);
    expect(screen.getByTestId('out')).toHaveTextContent('Abrir');
  });

  it('answers with the bare key for a namespace nobody registered', () => {
    render(<Bare ns="nowhere" k="some.key" />);
    expect(screen.getByTestId('out')).toHaveTextContent('some.key');
  });

  it('strips the namespace off a qualified key it cannot resolve', () => {
    // What i18next does, so swapping the binding in or out changes nothing a
    // caller can see.
    render(<Bare k="nowhere:some.key" />);
    expect(screen.getByTestId('out')).toHaveTextContent('some.key');
  });

  it('answers with the key when the namespace is registered but the key is not', () => {
    render(<Bare k="table.nothingLikeThis" />);
    expect(screen.getByTestId('out')).toHaveTextContent('table.nothingLikeThis');
  });

  it('picks the singular and the plural form from a count', () => {
    render(<Bare k="value.rowCount" params={{ count: 1 }} />);
    expect(screen.getByTestId('out')).toHaveTextContent('1 fila');
  });

  it('interpolates a parameter, and leaves an unmatched placeholder alone', () => {
    render(<Bare k="validation.required" params={{ field: 'Código' }} />);
    expect(screen.getByTestId('out')).toHaveTextContent('Código es obligatorio');
  });

  it('stops at a key that names an object rather than a sentence', () => {
    render(<Bare k="table" />);
    expect(screen.getByTestId('out')).toHaveTextContent('table');
  });

  it('stops at a key whose path runs through a string', () => {
    // `table.open` is a sentence, so `table.open.deeper` has nowhere to go.
    render(<Bare k="table.open.deeper" />);
    expect(screen.getByTestId('out')).toHaveTextContent('table.open.deeper');
  });

  it('falls back to the unsuffixed key when a count has no plural forms', () => {
    render(<Bare k="table.open" params={{ count: 3 }} />);
    expect(screen.getByTestId('out')).toHaveTextContent('Abrir');
  });

  it('leaves a placeholder the parameters do not name', () => {
    render(<Bare k="validation.required" params={{ other: 'x' }} />);
    expect(screen.getByTestId('out')).toHaveTextContent('{{field}}');
  });

  it('takes a namespace another package registers', () => {
    registerFallbackCatalog('demo', { es: { hello: 'Hola' }, en: { hello: 'Hi' } });
    render(<Bare ns="demo" k="hello" />);
    expect(screen.getByTestId('out')).toHaveTextContent('Hola');
  });
});
