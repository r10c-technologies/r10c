import type { ThirdPartyModule } from 'i18next';
import { describe, expect, it } from 'vitest';

import { createI18n, sharedFallbackI18n } from './instance.js';

describe('createI18n', () => {
  it('resolves keys synchronously, so the first paint is already translated', () => {
    const i18n = createI18n('es');

    expect(i18n.isInitialized).toBe(true);
    expect(i18n.t('controls:table.open')).toBe('Abrir');
  });

  it('serves each locale from its own catalog', () => {
    expect(createI18n('en').t('controls:table.open')).toBe('Open');
    expect(createI18n('en').t('entity:product.label')).toBe('Product');
    expect(createI18n('es').t('entity:product.label')).toBe('Producto');
  });

  it('interpolates without escaping, because React escapes for us', () => {
    const i18n = createI18n('es');

    expect(i18n.t('controls:validation.required', { field: 'Código' })).toBe(
      'Código es obligatorio',
    );
  });

  it('defaults to the controls namespace', () => {
    expect(createI18n('es').t('table.actions')).toBe('Acciones');
  });

  it('isolates instances, so one request cannot leak its locale into another', () => {
    const es = createI18n('es');
    const en = createI18n('en');

    expect(es.t('controls:form.save')).toBe('Guardar');
    expect(en.t('controls:form.save')).toBe('Save');
  });

  it('applies the modules it is handed', () => {
    let received: unknown;
    const probe: ThirdPartyModule = {
      type: '3rdParty',
      init: instance => {
        received = instance;
      },
    };

    const i18n = createI18n('es', [probe]);

    expect(received).toBe(i18n);
  });
});

describe('sharedFallbackI18n', () => {
  it('serves the fleet default locale, not raw keys', () => {
    expect(sharedFallbackI18n().t('controls:table.open')).toBe('Abrir');
  });

  it('hands every caller the same instance', () => {
    // The point of the memo: each React package resolves copy through its own
    // `useTranslation`, and a second instance here would mean two copies of
    // every catalog in a process that already decided what "no provider" means.
    expect(sharedFallbackI18n()).toBe(sharedFallbackI18n());
  });

  it('ignores modules once built, since the first caller settled it', () => {
    sharedFallbackI18n(); // whoever got here first; asserted independently of order
    let called = false;
    const probe: ThirdPartyModule = {
      type: '3rdParty',
      init: () => {
        called = true;
      },
    };

    sharedFallbackI18n([probe]);

    expect(called).toBe(false);
  });
});
