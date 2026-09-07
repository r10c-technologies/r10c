import { describe, expect, it } from 'vitest';

import {
  commandEffectOf,
  foldForMatch,
  matchesCommand,
  parseCommandTerm,
  parseKeywords,
  subsequenceMatch,
} from './command-matching.js';
import type { CommandOption } from './command-source.js';

const option = (overrides: Partial<CommandOption> = {}): CommandOption => ({
  id: 'new-product',
  label: 'Nuevo producto',
  href: '/catalog/product/new',
  ...overrides,
});

/** A stand-in effect. An empty arrow is a lint error; this one is deliberate. */
const noop = () => undefined;

describe('foldForMatch', () => {
  it('case-folds', () => {
    expect(foldForMatch('Nuevo Producto')).toBe('nuevo producto');
  });

  it('strips accents so the unaccented spelling is the same string', () => {
    expect(foldForMatch('Categoría')).toBe(foldForMatch('categoria'));
    expect(foldForMatch('Marrón')).toBe('marron');
  });

  it('decomposes ñ, so a quick typist still finds the word', () => {
    expect(foldForMatch('Niño')).toBe('nino');
  });
});

describe('subsequenceMatch', () => {
  it('matches characters in order without requiring them to be adjacent', () => {
    expect(subsequenceMatch('numa', 'Nueva marca')).toBe(true);
  });

  it('rejects characters that appear out of order', () => {
    expect(subsequenceMatch('aman', 'Nueva marca')).toBe(false);
  });

  it('rejects a term the text runs out before completing', () => {
    expect(subsequenceMatch('marcas', 'Marca')).toBe(false);
  });

  it('matches an accented label from an unaccented term, and back', () => {
    expect(subsequenceMatch('categoria', 'Categoría')).toBe(true);
    expect(subsequenceMatch('Categoría', 'categoria')).toBe(true);
  });

  it('matches everything on an empty term, so an unfiltered list is one path', () => {
    expect(subsequenceMatch('', 'anything at all')).toBe(true);
  });
});

describe('matchesCommand', () => {
  it('matches on the label', () => {
    expect(matchesCommand('prod', option())).toBe(true);
  });

  it('matches on a keyword, which is how English finds Spanish copy', () => {
    expect(matchesCommand('new', option({ keywords: ['new', 'create'] }))).toBe(
      true,
    );
  });

  it('does not match when neither the label nor any keyword answers', () => {
    expect(matchesCommand('zzz', option({ keywords: ['new'] }))).toBe(false);
  });

  it('treats an option with no keywords as label-only', () => {
    expect(matchesCommand('zzz', option())).toBe(false);
  });
});

describe('parseKeywords', () => {
  it('splits a catalog string on commas and trims', () => {
    expect(parseKeywords(' new , create ,añadir')).toEqual([
      'new',
      'create',
      'añadir',
    ]);
  });

  it('drops empty entries, which would otherwise match every term', () => {
    expect(parseKeywords('new,,  ,create')).toEqual(['new', 'create']);
  });

  it('reads an absent key as no keywords', () => {
    expect(parseKeywords(undefined)).toEqual([]);
  });
});

describe('parseCommandTerm', () => {
  it('narrows to commands on ">" and strips the prefix', () => {
    expect(parseCommandTerm('>nuevo')).toEqual({
      scope: 'commands',
      term: 'nuevo',
    });
  });

  it('narrows to records on "#"', () => {
    expect(parseCommandTerm('# acme')).toEqual({
      scope: 'records',
      term: 'acme',
    });
  });

  it('searches everything with no prefix', () => {
    expect(parseCommandTerm('acme')).toEqual({ scope: 'all', term: 'acme' });
  });

  it('keeps a trailing space, which the person is still typing', () => {
    expect(parseCommandTerm('>nuevo ').term).toBe('nuevo ');
  });
});

describe('commandEffectOf', () => {
  it('names the single declared effect', () => {
    expect(commandEffectOf(option())).toBe('href');
    expect(commandEffectOf(option({ href: undefined, run: noop }))).toBe('run');
    expect(commandEffectOf(option({ href: undefined, push: 'new' }))).toBe(
      'push',
    );
  });

  it('throws on an option that would look selectable and do nothing', () => {
    expect(() => commandEffectOf(option({ href: undefined }))).toThrow(
      /declares 0 effects \(none\)/,
    );
  });

  it('throws on an option whose behaviour would depend on check order', () => {
    expect(() => commandEffectOf(option({ push: 'new' }))).toThrow(
      /declares 2 effects \(href, push\)/,
    );
  });
});
