import { r10c } from './es/r10c.js';

/**
 * The back office addresses its users as `usted` (#531). Wizard and till copy
 * had drifted into `tú` ("Elige", "Agrega") and voseo ("Elegí", "querés"),
 * sometimes on the same screen. The storefront speaks to buyers as `tú` on
 * purpose, so only the back office's `wizard.*` and `sales.*` copy is held to
 * it here.
 */
const INFORMAL =
  /(?<![\p{L}])(elige|selecciona|agrega|ingresa|escribe|revisa|añade|busca|completa|indica|estás|tu|tus|puedes|tienes|elegí|seleccioná|agregá|ingresá|revisá|querés|habías)(?![\p{L}])/iu;

const informalPhrases = (node: unknown, path: string): string[] => {
  if (typeof node === 'string') {
    return INFORMAL.test(node) ? [`${path}: ${node}`] : [];
  }
  if (node !== null && typeof node === 'object') {
    return Object.entries(node).flatMap(([key, value]) =>
      informalPhrases(value, `${path}.${key}`),
    );
  }
  return [];
};

describe('the back office register', () => {
  it('catches a planted informal imperative', () => {
    expect(informalPhrases({ hint: 'Elige algo.' }, 'planted')).toEqual([
      'planted.hint: Elige algo.',
    ]);
    expect(informalPhrases({ hint: 'Elija algo.' }, 'planted')).toEqual([]);
  });

  it('writes wizard and till copy as usted', () => {
    expect([
      ...informalPhrases(r10c.sales, 'sales'),
      ...informalPhrases(
        r10c.marketplaceAdmin.wizard,
        'marketplaceAdmin.wizard',
      ),
    ]).toEqual([]);
  });
});
