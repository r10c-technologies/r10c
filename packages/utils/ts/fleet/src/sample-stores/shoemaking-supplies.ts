import { product } from './product.js';
import type { SampleProduct } from './types.js';

const BY_THE_YARD = { unit: 'YD', step: 500, minimum: 1000 } as const;

/**
 * The shoemaking-supplies store's catalog: faux leather and linings by the
 * yard from one yard up (the fabric and faux-leather stores the research
 * found sell that way), soles and heels by the pair, contact cement by the
 * quarter litre, and findings by the piece or per hundred.
 *
 * ⚠️ **No natural leather.** Whether a hide is sold by the piece, the foot or
 * what was measured is what the merchant calls in #644 ask, and ADR 0082 §9
 * may be reopened by the answer. The store sells only goods whose unit the
 * research verified.
 */
export const SHOEMAKING_SUPPLY_PRODUCTS: readonly SampleProduct[] = [
  product(
    {
      key: 'cuerina-negra',
      name: 'Cuerina negra calibre 1.2 mm',
      description: 'Respaldo textil, ancho de 54". Por yarda.',
      brand: 'curtidos-del-valle',
      category: 'faux-leather',
      art: 'roll',
      amount: 4500,
      status: 'published',
      stock: 120,
    },
    // One product in two colours (ADR 0085).
    {
      ...BY_THE_YARD,
      variant: { values: [{ axis: 'color', value: 'negro' }] },
      tone: '#2b2b2b',
    },
  ),
  product(
    {
      key: 'cuerina-cafe',
      name: 'Cuerina café calibre 1.2 mm',
      description: 'Respaldo textil, ancho de 54". Por yarda.',
      brand: 'curtidos-del-valle',
      category: 'faux-leather',
      art: 'roll',
      amount: 4500,
      status: 'published',
      stock: 90,
    },
    {
      ...BY_THE_YARD,
      variant: {
        values: [{ axis: 'color', value: 'café' }],
        of: 'cuerina-negra',
      },
      tone: '#7a4a24',
    },
  ),
  product(
    {
      key: 'charol-negro',
      name: 'Charol sintético negro',
      description: 'Acabado brillante, ancho de 54". Por yarda.',
      brand: 'curtidos-del-valle',
      category: 'faux-leather',
      art: 'roll',
      amount: 5500,
      status: 'published',
      stock: 60,
    },
    BY_THE_YARD,
  ),
  product(
    {
      key: 'forro-textil-beige',
      name: 'Forro textil para calzado, beige',
      description: 'Transpirable, ancho de 60". Por yarda.',
      brand: 'curtidos-del-valle',
      category: 'linings',
      art: 'roll',
      amount: 2500,
      status: 'published',
      stock: 150,
    },
    BY_THE_YARD,
  ),
  product(
    {
      key: 'forro-sintetico-negro',
      name: 'Forro sintético negro',
      description: 'Ancho de 54". Por yarda.',
      brand: 'curtidos-del-valle',
      category: 'linings',
      art: 'roll',
      amount: 3500,
      status: 'published',
      stock: 'sold-out',
    },
    BY_THE_YARD,
  ),
  product(
    {
      key: 'suela-hule-caballero',
      name: 'Suela de hule para caballero, talla 40',
      description: 'Antiderrapante.',
      brand: 'suelatex',
      category: 'soles',
      art: 'sole',
      amount: 3500,
      status: 'published',
      stock: 40,
    },
    // By size and colour (ADR 0085); the other variants close the list.
    {
      unit: 'PAR',
      variant: {
        values: [
          { axis: 'color', value: 'negro' },
          { axis: 'size', value: '40' },
        ],
      },
      tone: '#2b2b2b',
    },
  ),
  product(
    {
      key: 'suela-pu-dama',
      name: 'Suela de PU para dama, talla 37',
      description: 'Ligera, con tacón bajo integrado.',
      brand: 'suelatex',
      category: 'soles',
      art: 'sole',
      amount: 3200,
      status: 'published',
      stock: 35,
    },
    { unit: 'PAR' },
  ),
  product(
    {
      key: 'tacon-dama-7',
      name: 'Tacón para dama 7 cm',
      description: 'Plástico inyectado, forrable.',
      brand: 'suelatex',
      category: 'soles',
      art: 'heel',
      amount: 2500,
      status: 'published',
      stock: 30,
    },
    { unit: 'PAR' },
  ),
  product(
    {
      key: 'plantilla-eva',
      name: 'Plantilla de EVA',
      description: 'Recortable, tallas 35 a 44.',
      brand: 'suelatex',
      category: 'soles',
      art: 'insole',
      amount: 1500,
      status: 'published',
      stock: 60,
    },
    { unit: 'PAR' },
  ),
  product(
    {
      key: 'pegamento-contacto',
      name: 'Pegamento de contacto amarillo',
      description: 'Para cuero, cuerina y hule. Por litro, desde un cuarto.',
      brand: 'pegafuerte',
      category: 'adhesives',
      art: 'bottle',
      amount: 6500,
      status: 'published',
      stock: 40,
    },
    { unit: 'L', step: 250, minimum: 250 },
  ),
  product({
    key: 'hilo-nylon-40',
    name: 'Hilo de nylon #40, carrete',
    description: 'Para costura a máquina, 1 500 m.',
    brand: 'hilos-del-lago',
    category: 'findings',
    art: 'thread',
    amount: 3500,
    status: 'published',
    stock: 50,
  }),
  product(
    {
      key: 'hebilla-metal-2cm',
      name: 'Hebilla metálica 2 cm',
      description: 'Acabado níquel. Precio por ciento.',
      brand: 'hilos-del-lago',
      category: 'findings',
      art: 'buckle',
      amount: 9000,
      status: 'published',
      stock: 3000,
    },
    { pricePer: 100 },
  ),
  product(
    {
      key: 'ojalillo-5mm',
      name: 'Ojalillo de latón 5 mm',
      description: 'Con arandela. Precio por ciento.',
      brand: 'hilos-del-lago',
      category: 'findings',
      art: 'eyelet',
      amount: 1500,
      status: 'published',
      stock: 10000,
    },
    { pricePer: 100 },
  ),
  product({
    key: 'cierre-bota-15',
    name: 'Cierre para bota 15 cm',
    description: 'Diente de nylon #5.',
    brand: 'hilos-del-lago',
    category: 'findings',
    art: 'zipper',
    amount: 600,
    status: 'published',
    stock: 200,
  }),
  product({
    key: 'tinte-negro',
    name: 'Tinte para cuero, negro 100 ml',
    description: 'Base alcohol.',
    brand: 'pegafuerte',
    category: 'adhesives',
    art: 'bottle',
    amount: 2800,
    status: 'pending-review',
    stock: 25,
  }),
  product(
    {
      key: 'agujetas-redondas',
      name: 'Agujetas redondas 90 cm',
      description: 'Algodón encerado.',
      brand: 'hilos-del-lago',
      category: 'findings',
      art: 'laces',
      amount: 500,
      status: 'unpublished',
      stock: 100,
    },
    { unit: 'PAR' },
  ),
  product(
    {
      key: 'cuerina-roja',
      name: 'Cuerina roja calibre 1.0 mm',
      description: 'Respaldo textil, ancho de 54". Por yarda.',
      brand: 'curtidos-del-valle',
      category: 'faux-leather',
      art: 'roll',
      amount: 4800,
      status: 'draft',
      stock: 'none',
    },
    BY_THE_YARD,
  ),
  product(
    {
      key: 'suela-crepe',
      name: 'Suela de crepé natural',
      description: 'Lámina para recortar.',
      brand: 'suelatex',
      category: 'soles',
      art: 'sole',
      amount: 4500,
      status: 'draft',
      stock: 10,
    },
    { unit: 'PAR' },
  ),
  // The rubber sole's other sizes and colours (ADR 0085), appended because
  // a product's position is its id.
  ...(
    [
      ['negro', '41', '#2b2b2b', 25],
      ['café', '40', '#7a4a24', 12],
      ['café', '42', '#7a4a24', 8],
    ] as const
  ).map(([color, size, tone, stock]) =>
    product(
      {
        key: `suela-hule-caballero-${color === 'café' ? 'cafe' : color}-${size}`,
        name: `Suela de hule para caballero, ${color}, talla ${size}`,
        description: 'Antiderrapante.',
        brand: 'suelatex',
        category: 'soles',
        art: 'sole',
        amount: 3500,
        status: 'published',
        stock,
      },
      {
        unit: 'PAR',
        variant: {
          values: [
            { axis: 'color', value: color },
            { axis: 'size', value: size },
          ],
          of: 'suela-hule-caballero',
        },
        tone,
      },
    ),
  ),
];
