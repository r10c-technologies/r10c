import { product } from './product.js';
import type { SampleProduct } from './types.js';

/** The seeded device models (marketplace-service), by what a product fits. */
const A15 = ['device-model-1', 'device-model-2'];
const A25 = ['device-model-3'];
const A35 = ['device-model-4'];
const S24 = ['device-model-5'];
const REDMI_NOTE_13 = ['device-model-6'];
const REDMI_13C = ['device-model-7'];
const IPHONE_13_14 = ['device-model-8', 'device-model-9'];
const IPHONE_15 = ['device-model-10'];
const MOTO_G24 = ['device-model-11'];
const HONOR_X7B = ['device-model-12'];
const TECNO_SPARK_20 = ['device-model-13'];
/** Every seeded phone with a USB-C port: all but the iPhone 13 and 14. */
const USB_C = [
  ...A15,
  ...A25,
  ...A35,
  ...S24,
  ...REDMI_NOTE_13,
  ...REDMI_13C,
  ...IPHONE_15,
  ...MOTO_G24,
  ...HONOR_X7B,
  ...TECNO_SPARK_20,
];
const EVERY_PHONE = [...USB_C, ...IPHONE_13_14];

/**
 * The phone-accessories store's catalog: everything by the piece, each made
 * for named phone models (#641), so the storefront's "my phone" filter has
 * something to narrow. No price steps down by quantity here — wholesale in
 * this vertical is a price list per customer, which is outside the MVP.
 */
export const PHONE_ACCESSORY_PRODUCTS: readonly SampleProduct[] = [
  product(
    {
      key: 'funda-silicon-a15',
      name: 'Funda de silicón Galaxy A15',
      description: 'Interior de microfibra, bordes elevados.',
      brand: 'kinetik',
      category: 'cases',
      art: 'case',
      amount: 6500,
      status: 'published',
      stock: 30,
    },
    // The first of three colours (ADR 0085); the other two close the list.
    {
      fits: A15,
      variant: { values: [{ axis: 'color', value: 'negro' }] },
      tone: '#2b2b2b',
    },
  ),
  product(
    {
      key: 'funda-silicon-a25',
      name: 'Funda de silicón Galaxy A25',
      description: 'Interior de microfibra, bordes elevados.',
      brand: 'kinetik',
      category: 'cases',
      art: 'case',
      amount: 6500,
      status: 'published',
      stock: 25,
    },
    { fits: A25 },
  ),
  product(
    {
      key: 'funda-antigolpes-iphone-13',
      name: 'Funda antigolpes iPhone 13 y 14',
      description: 'Esquinas reforzadas, espalda transparente.',
      brand: 'kinetik',
      category: 'cases',
      art: 'case',
      amount: 9500,
      status: 'published',
      stock: 20,
    },
    { fits: IPHONE_13_14 },
  ),
  product(
    {
      key: 'funda-antigolpes-iphone-15',
      name: 'Funda antigolpes iPhone 15',
      description: 'Esquinas reforzadas, espalda transparente.',
      brand: 'kinetik',
      category: 'cases',
      art: 'case',
      amount: 9900,
      status: 'published',
      stock: 18,
    },
    { fits: IPHONE_15 },
  ),
  product(
    {
      key: 'funda-cartera-redmi-note-13',
      name: 'Funda tipo cartera Redmi Note 13',
      description: 'Tapa con imán y tres ranuras para tarjeta.',
      brand: 'kinetik',
      category: 'cases',
      art: 'case',
      amount: 8500,
      status: 'published',
      stock: 12,
    },
    { fits: REDMI_NOTE_13 },
  ),
  product(
    {
      key: 'funda-transparente-moto-g24',
      name: 'Funda transparente Moto G24',
      description: 'TPU flexible.',
      brand: 'kinetik',
      category: 'cases',
      art: 'case',
      amount: 4500,
      status: 'published',
      stock: 15,
    },
    { fits: MOTO_G24 },
  ),
  product(
    {
      key: 'vidrio-a15',
      name: 'Vidrio templado 9H Galaxy A15',
      description: 'Cubre toda la pantalla, incluye guía de instalación.',
      brand: 'vidriopro',
      category: 'glass',
      art: 'glass',
      amount: 3500,
      status: 'published',
      stock: 60,
    },
    { fits: A15 },
  ),
  product(
    {
      key: 'vidrio-iphone-13',
      name: 'Vidrio templado 9H iPhone 13 y 14',
      description: 'Cubre toda la pantalla, incluye guía de instalación.',
      brand: 'vidriopro',
      category: 'glass',
      art: 'glass',
      amount: 4000,
      status: 'published',
      stock: 50,
    },
    { fits: IPHONE_13_14 },
  ),
  product(
    {
      key: 'vidrio-redmi-13c',
      name: 'Vidrio templado 9H Redmi 13C',
      description: 'Cubre toda la pantalla.',
      brand: 'vidriopro',
      category: 'glass',
      art: 'glass',
      amount: 3000,
      status: 'published',
      stock: 'sold-out',
    },
    { fits: REDMI_13C },
  ),
  product(
    {
      key: 'vidrio-honor-x7b',
      name: 'Vidrio templado 9H Honor X7b',
      description: 'Cubre toda la pantalla.',
      brand: 'vidriopro',
      category: 'glass',
      art: 'glass',
      amount: 3000,
      status: 'published',
      stock: 25,
    },
    { fits: HONOR_X7B },
  ),
  product(
    {
      key: 'cargador-usb-c-20w',
      name: 'Cargador de pared USB-C 20 W',
      description: 'Carga rápida, un puerto.',
      brand: 'cargamas',
      category: 'charging',
      art: 'charger',
      amount: 12900,
      status: 'published',
      stock: 40,
    },
    { fits: USB_C },
  ),
  product(
    {
      key: 'cable-usb-c',
      name: 'Cable USB-C a USB-C, 1 m',
      description: 'Trenzado, 60 W.',
      brand: 'cargamas',
      category: 'charging',
      art: 'usb',
      amount: 4500,
      status: 'published',
      stock: 80,
    },
    { fits: USB_C },
  ),
  product(
    {
      key: 'cable-lightning',
      name: 'Cable USB-C a Lightning, 1 m',
      description: 'Para iPhone 13 y 14.',
      brand: 'cargamas',
      category: 'charging',
      art: 'usb',
      amount: 5500,
      status: 'published',
      stock: 35,
    },
    { fits: IPHONE_13_14 },
  ),
  product(
    {
      key: 'audifonos-inalambricos',
      name: 'Audífonos inalámbricos con estuche',
      description: 'Bluetooth 5.3, hasta 20 horas con el estuche.',
      brand: 'sonora',
      category: 'audio',
      art: 'earbuds',
      amount: 19900,
      status: 'published',
      stock: 15,
    },
    { fits: EVERY_PHONE },
  ),
  product(
    {
      key: 'soporte-auto',
      name: 'Soporte magnético para auto',
      description: 'Se fija a la rejilla de ventilación.',
      brand: 'sonora',
      category: 'audio',
      art: 'holder',
      amount: 7900,
      status: 'published',
      stock: 20,
    },
    { fits: EVERY_PHONE },
  ),
  product(
    {
      key: 'bateria-10000',
      name: 'Batería externa 10 000 mAh',
      description: 'Salida USB-C de 20 W.',
      brand: 'cargamas',
      category: 'charging',
      art: 'battery',
      amount: 17900,
      status: 'pending-review',
      stock: 10,
    },
    { fits: USB_C },
  ),
  product(
    {
      key: 'funda-piel-s24',
      name: 'Funda de piel sintética Galaxy S24',
      description: 'Tapa con imán.',
      brand: 'kinetik',
      category: 'cases',
      art: 'case',
      amount: 14900,
      status: 'unpublished',
      stock: 8,
    },
    { fits: S24 },
  ),
  product(
    {
      key: 'vidrio-tecno-spark-20',
      name: 'Vidrio templado 9H Tecno Spark 20',
      description: 'Cubre toda la pantalla.',
      brand: 'vidriopro',
      category: 'glass',
      art: 'glass',
      amount: 3000,
      status: 'draft',
      stock: 'none',
    },
    { fits: TECNO_SPARK_20 },
  ),
  product(
    {
      key: 'funda-silicon-a35',
      name: 'Funda de silicón Galaxy A35',
      description: 'Interior de microfibra, bordes elevados.',
      brand: 'kinetik',
      category: 'cases',
      art: 'case',
      amount: 6500,
      status: 'draft',
      stock: 10,
    },
    { fits: A35 },
  ),
  // The silicone case's other colours (ADR 0085): offerings of its product,
  // each with its own price row and stock. Appended, because a product's
  // position is its id.
  ...(
    [
      ['azul', 'Funda de silicón Galaxy A15, azul', '#1f5fbf', 18],
      ['rosa', 'Funda de silicón Galaxy A15, rosa', '#d9468f', 'sold-out'],
    ] as const
  ).map(([value, name, tone, stock]) =>
    product(
      {
        key: `funda-silicon-a15-${value}`,
        name,
        description: 'Interior de microfibra, bordes elevados.',
        brand: 'kinetik',
        category: 'cases',
        art: 'case',
        amount: 6500,
        status: 'published',
        stock,
      },
      {
        fits: A15,
        variant: {
          values: [{ axis: 'color', value }],
          of: 'funda-silicon-a15',
        },
        tone,
      },
    ),
  ),
  // A kit (ADR 0086), last so every product keeps its positional id: the
  // black case and its screen protector at one price, each from its own stock.
  product(
    {
      key: 'kit-proteccion-a15',
      name: 'Kit de protección Galaxy A15: funda y vidrio',
      description: 'La funda de silicón negra y el vidrio templado 9H, juntos.',
      brand: 'kinetik',
      category: 'cases',
      art: 'case',
      amount: 8900,
      status: 'published',
      stock: 'none',
    },
    {
      fits: A15,
      kit: [
        { key: 'funda-silicon-a15', quantity: 1 },
        { key: 'vidrio-a15', quantity: 1 },
      ],
    },
  ),
];
