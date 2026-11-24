import { describe, expect, it } from 'vitest';

import { SITE_LOCALES } from './copy';
import { lifecyclePage, LIFECYCLES, resolveStep } from './lifecycles';

describe('the lifecycles (#688)', () => {
  it('names only what the registers hold', () => {
    for (const lifecycle of LIFECYCLES) {
      for (const step of lifecycle.steps) {
        expect(() => resolveStep(lifecycle.id, step)).not.toThrow();
      }
    }
  });

  it('shows the unbuilt payout as planned, and every other step as built', () => {
    const planned = LIFECYCLES.flatMap(lifecycle =>
      lifecycle.steps
        .map(step => resolveStep(lifecycle.id, step))
        .filter(
          resolved =>
            resolved.kind === 'capability' &&
            resolved.capability.status !== 'implemented',
        ),
    );
    expect(planned).toEqual([
      expect.objectContaining({
        capability: expect.objectContaining({
          id: 'settlement-management:vendor-payout:disburse',
        }),
      }),
    ]);
  });

  it.each(SITE_LOCALES)('writes a page per lifecycle in %s', locale => {
    for (const lifecycle of LIFECYCLES) {
      const page = lifecyclePage(locale, lifecycle, []);
      expect(
        page.markdown.split('\n').filter(row => row.startsWith('| ')),
      ).toHaveLength(lifecycle.steps.length + 2);
    }
    const payout = LIFECYCLES.find(lifecycle => lifecycle.id === 'payout');
    expect(
      lifecyclePage(locale, payout ?? LIFECYCLES[0], []).markdown,
    ).toContain('**');
  });

  it.each([
    [{ id: 'x', capability: 'stock-management:nothing:read' }, /does not hold/],
    [
      {
        id: 'x',
        route: { slice: 'stock', method: 'PUT', path: '/api/reservation' },
      },
      /does not serve/,
    ],
    [
      { id: 'x', event: { name: 'order.placed', from: 'stock' } },
      /does not publish/,
    ],
    [
      { id: 'x', event: { name: 'order.placed', from: 'order', to: 'stock' } },
      /does not subscribe/,
    ],
    [{ id: 'x', sweep: { slice: 'nowhere' } }, /no slice 'nowhere'/],
  ] as const)(
    'refuses a step the registers do not hold: %o',
    (step, message) => {
      expect(() => resolveStep('test', step)).toThrow(message);
    },
  );
});
