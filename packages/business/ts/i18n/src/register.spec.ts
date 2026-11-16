import { r10c } from './es/r10c.js';

/**
 * The back office addresses its users as `usted` (#531). Wizard and till copy
 * had drifted into `tú` ("Elige", "Agrega") and voseo ("Elegí", "querés"),
 * sometimes on the same screen. The storefront speaks to buyers as `tú` on
 * purpose, so only the back office's `wizard.*` and `sales.*` copy is held to
 * `usted` here, and the storefront's own copy is held to `tú` below.
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

/**
 * The storefront speaks to buyers as `tú` (#570): formal forms a buyer would
 * read as the back office leaking through.
 */
const FORMAL =
  /(?<![\p{L}])(usted|ustedes|elija|seleccione|agregue|ingrese|escriba|revise|añada|busque|complete|indique|confirme|pague|vuelva|intente|cancele|espere)(?![\p{L}])/iu;

const formalPhrases = (node: unknown, path: string): string[] => {
  if (typeof node === 'string') {
    return FORMAL.test(node) ? [`${path}: ${node}`] : [];
  }
  if (node !== null && typeof node === 'object') {
    return Object.entries(node).flatMap(([key, value]) =>
      formalPhrases(value, `${path}.${key}`),
    );
  }
  return [];
};

describe('the storefront register', () => {
  it('catches a planted formal imperative', () => {
    expect(formalPhrases({ hint: 'Revise su pedido.' }, 'planted')).toEqual([
      'planted.hint: Revise su pedido.',
    ]);
    expect(formalPhrases({ hint: 'Revisa tu pedido.' }, 'planted')).toEqual([]);
  });

  it('writes every storefront string as tú', () => {
    expect(formalPhrases(r10c.storefront, 'storefront')).toEqual([]);
  });
});

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
