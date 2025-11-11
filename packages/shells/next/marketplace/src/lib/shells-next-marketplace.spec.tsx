import { render } from '@testing-library/react';

import R10cShellsNextMarketplace from './shells-next-marketplace';

describe('R10cShellsNextMarketplace', () => {
  it('should render successfully', () => {
    const { baseElement } = render(<R10cShellsNextMarketplace />);
    expect(baseElement).toBeTruthy();
  });
});
