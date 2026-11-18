import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { decodeShipmentDestination } from './shipment-destination.js';

const where = {
  departamento: '01',
  municipio: '0108',
  zona: 4,
  addressLine: '5a avenida 12-34',
  reference: 'portón negro',
};

describe('decodeShipmentDestination', () => {
  it('stores who receives the parcel and where, with no email', async () => {
    const row = await Effect.runPromise(
      decodeShipmentDestination({
        name: ' Ana ',
        phone: '5555 1234',
        destination: where,
      }),
    );

    expect([
      row.name,
      row.phone,
      row.departamento,
      row.municipio,
      row.zona,
      row.addressLine,
      row.reference,
    ]).toEqual([
      'Ana',
      '+50255551234',
      '01',
      '0108',
      4,
      '5a avenida 12-34',
      'portón negro',
    ]);
    expect('email' in row).toBe(false);
  });

  it('refuses with every field it got wrong, under /destination', async () => {
    const missing = await Effect.runPromise(
      Effect.flip(decodeShipmentDestination(undefined)),
    );
    const partial = await Effect.runPromise(
      Effect.flip(
        decodeShipmentDestination({
          name: 'Ana',
          phone: '5555-1234',
          destination: { ...where, municipio: '0201' },
        }),
      ),
    );

    expect(missing.errors.map(error => error.pointer)).toEqual([
      '/destination/name',
      '/destination/phone',
      '/destination/destination/departamento',
      '/destination/destination/municipio',
      '/destination/destination/addressLine',
    ]);
    expect(partial.errors.map(error => error.code)).toEqual([
      'municipioOutsideDepartamento',
    ]);
  });
});
