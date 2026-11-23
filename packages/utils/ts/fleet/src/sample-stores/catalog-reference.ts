import type { SampleBrand, SampleCategory } from './types.js';

/**
 * The platform vocabulary the three sample stores classify against: the
 * brands and the category tree marketplace-service seeds into
 * `catalog-reference`, which every vendor shares.
 *
 * ⚠️ **Every brand is invented.** The repository is public, and a real
 * manufacturer or distributor named in seed data is a claim about them that
 * nobody checked (ADR 0025). Websites point at `example.com`.
 *
 * Ordered on purpose: a brand's or a category's id is its position,
 * `product-brand-<n>` and `product-category-<n>`, so a reset lab names the
 * same rows every time.
 */
export const SAMPLE_BRANDS: ReadonlyArray<readonly [string, SampleBrand]> = [
  ['cobrelux', { name: 'Cobrelux', description: 'Cable y material eléctrico' }],
  [
    'tornimax',
    { name: 'Tornimax', description: 'Tornillería y fijación para obra' },
  ],
  [
    'ferroandes',
    { name: 'Ferroandes', description: 'Herramienta manual de uso general' },
  ],
  ['hidroflujo', { name: 'Hidroflujo', description: 'Plomería en PVC' }],
  [
    'pintuflex',
    {
      name: 'Pintuflex',
      description: 'Pinturas y acabados, ya no distribuida',
      retired: true,
    },
  ],
  ['kinetik', { name: 'Kinetik', description: 'Fundas y protección' }],
  ['vidriopro', { name: 'VidrioPro', description: 'Vidrio templado 9H' }],
  ['cargamas', { name: 'Cargamás', description: 'Carga, cables y baterías' }],
  ['sonora', { name: 'Sonora', description: 'Audio inalámbrico' }],
  [
    'curtidos-del-valle',
    {
      name: 'Curtidos del Valle',
      description: 'Cuerinas, sintéticos y forros',
    },
  ],
  [
    'suelatex',
    { name: 'Suelatex', description: 'Suelas, tacones y plantillas' },
  ],
  [
    'pegafuerte',
    { name: 'Pegafuerte', description: 'Adhesivos y tintes para calzado' },
  ],
  [
    'hilos-del-lago',
    { name: 'Hilos del Lago', description: 'Hilos, herrajes y avíos' },
  ],
];

const ROOT_HARDWARE = '#a6461f';
const ROOT_PHONE = '#2557a7';
const ROOT_SHOEMAKING = '#7a4b22';

/**
 * Three roots, one per vertical, and up to three levels under them (ADR 0062
 * allows five). Two rows seed **retired** so the retire verb's per-row report
 * has a refusal to show: a retired root with no children, and a retired leaf
 * under an active parent — never an active category under a retired one.
 */
export const SAMPLE_CATEGORIES: ReadonlyArray<
  readonly [string, SampleCategory]
> = [
  [
    'hardware',
    {
      code: 'FER',
      name: { es: 'Ferretería', en: 'Hardware' },
      description: {
        es: 'Material eléctrico, fijación, herramienta y plomería',
        en: 'Electrical supplies, fasteners, tools and plumbing',
      },
      tone: ROOT_HARDWARE,
    },
  ],
  [
    'electrical',
    {
      code: 'FER-ELE',
      parent: 'hardware',
      name: { es: 'Electricidad', en: 'Electrical' },
      description: {
        es: 'Cable, apagadores, tomacorrientes y cajas',
        en: 'Cable, switches, sockets and boxes',
      },
      tone: '#c27c0e',
    },
  ],
  [
    'cables',
    {
      code: 'FER-ELE-CAB',
      parent: 'electrical',
      name: { es: 'Cables y alambres', en: 'Cable and wire' },
      description: {
        es: 'Cable THHN y alambre por metro o por libra',
        en: 'THHN cable and wire by the metre or the pound',
      },
      tone: '#c27c0e',
    },
  ],
  [
    'switches',
    {
      code: 'FER-ELE-APA',
      parent: 'electrical',
      name: { es: 'Apagadores y tomacorrientes', en: 'Switches and sockets' },
      description: {
        es: 'Apagadores, tomacorrientes y cajas de registro',
        en: 'Switches, sockets and junction boxes',
      },
      tone: '#c27c0e',
    },
  ],
  [
    'fasteners',
    {
      code: 'FER-FIJ',
      parent: 'hardware',
      name: { es: 'Tornillería y fijación', en: 'Fasteners' },
      description: {
        es: 'Tornillos, clavos y tacos',
        en: 'Screws, nails and wall anchors',
      },
      tone: '#5b6770',
    },
  ],
  [
    'screws',
    {
      code: 'FER-FIJ-TOR',
      parent: 'fasteners',
      name: { es: 'Tornillos', en: 'Screws' },
      description: {
        es: 'Tornillos por ciento, para madera y tablayeso',
        en: 'Screws by the hundred, for wood and drywall',
      },
      tone: '#5b6770',
    },
  ],
  [
    'nails',
    {
      code: 'FER-FIJ-CLA',
      parent: 'fasteners',
      name: { es: 'Clavos y tacos', en: 'Nails and anchors' },
      description: {
        es: 'Clavos por libra y tacos de expansión',
        en: 'Nails by the pound and expansion anchors',
      },
      tone: '#5b6770',
    },
  ],
  [
    'hand-tools',
    {
      code: 'FER-HER',
      parent: 'hardware',
      name: { es: 'Herramienta manual', en: 'Hand tools' },
      description: {
        es: 'Martillos, desarmadores, alicates y medición',
        en: 'Hammers, screwdrivers, pliers and measuring',
      },
      tone: '#b3261e',
    },
  ],
  [
    'plumbing',
    {
      code: 'FER-PLO',
      parent: 'hardware',
      name: { es: 'Plomería', en: 'Plumbing' },
      description: {
        es: 'Tubo, llaves y accesorios de PVC',
        en: 'PVC pipe, valves and fittings',
      },
      tone: '#1f7a8c',
    },
  ],
  [
    'garden',
    {
      code: 'FER-JAR',
      parent: 'hardware',
      name: { es: 'Jardinería', en: 'Garden' },
      description: {
        es: 'Ya no se ofrece en la ferretería de muestra',
        en: 'No longer carried by the sample hardware store',
      },
      retired: true,
      tone: '#3f7d3a',
    },
  ],
  [
    'phone-accessories',
    {
      code: 'CEL',
      name: { es: 'Accesorios para celular', en: 'Phone accessories' },
      description: {
        es: 'Fundas, vidrio, carga y audio por modelo de teléfono',
        en: 'Cases, glass, charging and audio by phone model',
      },
      tone: ROOT_PHONE,
    },
  ],
  [
    'protection',
    {
      code: 'CEL-PRO',
      parent: 'phone-accessories',
      name: { es: 'Fundas y protectores', en: 'Cases and protectors' },
      description: {
        es: 'Fundas y vidrio templado',
        en: 'Cases and tempered glass',
      },
      tone: ROOT_PHONE,
    },
  ],
  [
    'cases',
    {
      code: 'CEL-PRO-FUN',
      parent: 'protection',
      name: { es: 'Fundas', en: 'Cases' },
      description: {
        es: 'Fundas de silicón, antigolpes y tipo cartera',
        en: 'Silicone, shockproof and wallet cases',
      },
      tone: ROOT_PHONE,
    },
  ],
  [
    'glass',
    {
      code: 'CEL-PRO-VID',
      parent: 'protection',
      name: { es: 'Vidrio templado', en: 'Tempered glass' },
      description: {
        es: 'Protectores de pantalla 9H',
        en: '9H screen protectors',
      },
      tone: '#3a8fb7',
    },
  ],
  [
    'charging',
    {
      code: 'CEL-CAR',
      parent: 'phone-accessories',
      name: { es: 'Carga y cables', en: 'Charging and cables' },
      description: {
        es: 'Cargadores, cables y baterías externas',
        en: 'Chargers, cables and power banks',
      },
      tone: '#2e7d32',
    },
  ],
  [
    'audio',
    {
      code: 'CEL-AUD',
      parent: 'phone-accessories',
      name: { es: 'Audio y soportes', en: 'Audio and mounts' },
      description: {
        es: 'Audífonos inalámbricos y soportes',
        en: 'Wireless earbuds and mounts',
      },
      tone: '#6a3fa0',
    },
  ],
  [
    'shoemaking',
    {
      code: 'PEL',
      name: { es: 'Peletería y zapatería', en: 'Shoemaking supplies' },
      description: {
        es: 'Materiales, suelas, adhesivos y avíos para calzado',
        en: 'Materials, soles, adhesives and findings for footwear',
      },
      tone: ROOT_SHOEMAKING,
    },
  ],
  [
    'materials',
    {
      code: 'PEL-MAT',
      parent: 'shoemaking',
      name: { es: 'Materiales', en: 'Materials' },
      description: {
        es: 'Cuerinas, sintéticos y forros por yarda',
        en: 'Faux leather, synthetics and linings by the yard',
      },
      tone: ROOT_SHOEMAKING,
    },
  ],
  [
    'faux-leather',
    {
      code: 'PEL-MAT-CUE',
      parent: 'materials',
      name: { es: 'Cuerina y sintéticos', en: 'Faux leather and synthetics' },
      description: {
        es: 'Cuerina y charol sintético por yarda',
        en: 'Faux leather and synthetic patent by the yard',
      },
      tone: ROOT_SHOEMAKING,
    },
  ],
  [
    'linings',
    {
      code: 'PEL-MAT-FOR',
      parent: 'materials',
      name: { es: 'Forros', en: 'Linings' },
      description: {
        es: 'Forros textiles y sintéticos por yarda',
        en: 'Textile and synthetic linings by the yard',
      },
      tone: '#a07850',
    },
  ],
  [
    'soles',
    {
      code: 'PEL-SUE',
      parent: 'shoemaking',
      name: {
        es: 'Suelas, tacones y plantillas',
        en: 'Soles, heels and insoles',
      },
      description: {
        es: 'Por par, por talla',
        en: 'By the pair, by size',
      },
      tone: '#40403f',
    },
  ],
  [
    'adhesives',
    {
      code: 'PEL-ADH',
      parent: 'shoemaking',
      name: { es: 'Adhesivos y tintes', en: 'Adhesives and dyes' },
      description: {
        es: 'Pegamento de contacto por litro y tintes',
        en: 'Contact cement by the litre and dyes',
      },
      tone: '#b8860b',
    },
  ],
  [
    'findings',
    {
      code: 'PEL-AVI',
      parent: 'shoemaking',
      name: { es: 'Hilos y avíos', en: 'Thread and findings' },
      description: {
        es: 'Hilo, hebillas, ojalillos, cierres y agujetas',
        en: 'Thread, buckles, eyelets, zips and laces',
      },
      tone: '#8a3b5c',
    },
  ],
  [
    'paint',
    {
      code: 'PIN',
      name: { es: 'Pinturas', en: 'Paint' },
      description: {
        es: 'Ya no se ofrece: ninguna tienda de muestra vende pintura',
        en: 'No longer offered: no sample store sells paint',
      },
      retired: true,
      tone: '#6d6d6d',
    },
  ],
];

const idsOf = (
  rows: ReadonlyArray<readonly [string, unknown]>,
  prefix: string,
): Readonly<Record<string, string>> =>
  Object.fromEntries(
    rows.map(([key], index) => [key, `${prefix}${index + 1}`]),
  );

/** A sample brand's id in `catalog-reference`, by key. */
export const SAMPLE_BRAND_IDS = idsOf(SAMPLE_BRANDS, 'product-brand-');

/** A sample category's id in `catalog-reference`, by key. */
export const SAMPLE_CATEGORY_IDS = idsOf(
  SAMPLE_CATEGORIES,
  'product-category-',
);

/** A sample category by key; throws on a key no row declares. */
export const sampleCategory = (key: string): SampleCategory => {
  const row = SAMPLE_CATEGORIES.find(([candidate]) => candidate === key);
  if (row === undefined) throw new Error(`No sample category '${key}'`);
  return row[1];
};
