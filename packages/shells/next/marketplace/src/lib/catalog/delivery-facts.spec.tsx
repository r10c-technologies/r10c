import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DeliveryFacts } from './delivery-facts';

const LABELS = {
  ships: 'Envío por el vendedor',
  cod: 'Pago contra entrega disponible',
  doesNotShip: 'Este vendedor no hace envíos.',
  atTheDoor: 'Qué pasa al recibirlo',
  refuse: 'Puedes rechazar el paquete al recibirlo.',
  noReturns: 'No hay devoluciones después de la entrega.',
};

describe('DeliveryFacts', () => {
  it('states shipping, cash on delivery and the door for a seller who ships', () => {
    const { container } = render(<DeliveryFacts ships labels={LABELS} />);

    expect(screen.getByText(LABELS.ships)).toBeTruthy();
    expect(screen.getByTestId('delivery-cod').textContent).toBe(LABELS.cod);
    // The door's terms are behind a native disclosure, open without script.
    expect(container.querySelector('details summary')?.textContent).toBe(
      LABELS.atTheDoor,
    );
    expect(container.querySelector('details')?.textContent).toContain(
      LABELS.noReturns,
    );
    expect(screen.queryByTestId('delivery-does-not-ship')).toBeNull();
  });

  it('says only that a seller who does not ship does not', () => {
    render(<DeliveryFacts ships={false} labels={LABELS} />);

    expect(screen.getByTestId('delivery-does-not-ship').textContent).toBe(
      LABELS.doesNotShip,
    );
    expect(screen.queryByTestId('delivery-facts')).toBeNull();
  });
});
