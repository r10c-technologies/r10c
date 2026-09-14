import { describe, expect, it, vi } from 'vitest';

import { wizardTabKind } from './wizard-tab-kind.js';

const render = vi.fn((step: string | undefined) => <p>{step ?? 'first'}</p>);

const kind = wizardTabKind({
  'product-setup': {
    titleKey: 'shell:marketplaceAdmin.wizard.productSetup',
    render,
  },
});

const translate = (key: string) => `«${key}»`;

describe('the wizard tab kind', () => {
  it('answers to the taxonomy prefix', () => {
    expect(kind.kind).toBe('wizard');
  });

  it('opens a flow at its first step', () => {
    expect(kind.match('product-setup')).toEqual({ key: 'product-setup' });
  });

  it('opens a flow at a step, which is what the third segment means here', () => {
    expect(kind.match('product-setup:identity')).toEqual({
      key: 'product-setup',
      id: 'identity',
    });
  });

  it('refuses a wizard the host did not register', () => {
    expect(kind.match('vendor-onboarding')).toBeNull();
  });

  it('refuses a malformed payload rather than opening onto nothing', () => {
    expect(kind.match('')).toBeNull();
    expect(kind.match('product-setup:')).toBeNull();
  });

  it('round-trips an address through the registry', () => {
    expect(kind.toParam({ key: 'product-setup' })).toBe('product-setup');
    expect(kind.toParam({ key: 'product-setup', id: 'identity' })).toBe(
      'product-setup:identity',
    );
  });

  it('captions the tab with the wizard, never the step', () => {
    // A title that changed on every Siguiente would reflow the strip mid-flow
    // and make an open wizard hard to find by the name it was opened under.
    const atFirst = kind.title({ key: 'product-setup' }, translate);
    const midFlow = kind.title(
      { key: 'product-setup', id: 'summary' },
      translate,
    );

    expect(atFirst).toBe('«shell:marketplaceAdmin.wizard.productSetup»');
    expect(midFlow).toBe(atFirst);
  });

  it('hands the step down to whatever renders the flow', () => {
    kind.render({ key: 'product-setup', id: 'identity' });
    kind.render({ key: 'product-setup' });

    expect(render.mock.calls).toEqual([['identity'], [undefined]]);
  });
});
