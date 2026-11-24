import { describe, expect, it } from 'vitest';

import { siteFor } from '../site';
import { guideProblems, verticalGuidesSource } from './guides';

describe('the vertical guides (#655)', () => {
  it('cite only what their vertical does', () => {
    expect(() => verticalGuidesSource()).not.toThrow();
  });

  it('are one per vertical, in the Spanish tree only', () => {
    const slugs = verticalGuidesSource().pages.map(page =>
      page.slugs.join('/'),
    );
    expect(slugs).toEqual([
      'guides/hardware',
      'guides/phone-accessories',
      'guides/shoemaking-supplies',
    ]);
    expect(siteFor('es').page(['guides', 'hardware'])).toBeDefined();
    expect(siteFor('en').page(['guides', 'hardware'])).toBeUndefined();
  });

  it('cite a use case on every step, and never a rate', () => {
    for (const page of verticalGuidesSource().pages) {
      const steps = page.markdown
        .split('\n')
        .filter(line => line.startsWith('- '));
      // A step's citation may sit on the lines that continue it.
      const items = page.markdown.split('\n- ').slice(1);
      expect(items.length, page.file).toBe(steps.length);
      for (const item of items) {
        expect(item, page.file).toMatch(/:use-case\[/);
      }
      expect(page.markdown, page.file).not.toMatch(/\d+\s?%/);
    }
  });

  it('refuses a citation the vertical does not do (ADR 0080 §6)', () => {
    expect(
      guideProblems([
        {
          name: 'hardware',
          markdown:
            'Filter :use-case[marketplace-catalog:published-offering:filter-by-device].',
        },
      ]),
    ).toEqual([
      "guides/hardware.md cites 'marketplace-catalog:published-offering:filter-by-device', which is for phone-accessories, not hardware",
    ]);
  });

  it('refuses a guide named for no vertical', () => {
    expect(guideProblems([{ name: 'bakery', markdown: '' }])[0]).toMatch(
      /named for no vertical/,
    );
  });

  it('leaves an unknown id to the engine, which refuses it at build', () => {
    expect(
      guideProblems([{ name: 'hardware', markdown: ':use-case[a:b:c]' }]),
    ).toEqual([]);
  });
});
