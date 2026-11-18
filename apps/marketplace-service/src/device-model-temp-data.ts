export interface DeviceModelRecord {
  id: string;
  code: string;
  name: string;
  maker: string;
  status: 'active' | 'retired';
}

/**
 * The phones the phone-accessories vertical's demo store sells for (plan 1.17,
 * from the verticals research): the models a Guatemalan accessories counter
 * actually stocks cases and glass for. Ids are stable so seeded specifications
 * can name them. Changing this needs a `dev:reset` — the seed only writes into
 * an empty collection.
 */
const MODELS: ReadonlyArray<readonly [maker: string, name: string]> = [
  ['Samsung', 'Samsung Galaxy A15'],
  ['Samsung', 'Samsung Galaxy A15 5G'],
  ['Samsung', 'Samsung Galaxy A25'],
  ['Samsung', 'Samsung Galaxy A35'],
  ['Samsung', 'Samsung Galaxy S24'],
  ['Xiaomi', 'Xiaomi Redmi Note 13'],
  ['Xiaomi', 'Xiaomi Redmi 13C'],
  ['Apple', 'iPhone 13'],
  ['Apple', 'iPhone 14'],
  ['Apple', 'iPhone 15'],
  ['Motorola', 'Motorola Moto G24'],
  ['Honor', 'Honor X7b'],
  ['Tecno', 'Tecno Spark 20'],
];

export const deviceModelTempData: DeviceModelRecord[] = MODELS.map(
  ([maker, name], index) => ({
    id: `device-model-${index + 1}`,
    code: `device-${String(index + 1).padStart(3, '0')}`,
    name,
    maker,
    status: 'active',
  }),
);
