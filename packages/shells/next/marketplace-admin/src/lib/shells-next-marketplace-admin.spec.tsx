import { render } from '@testing-library/react';

import R10cShellsNextMarketplaceAdmin from './shells-next-marketplace-admin';

describe('R10cShellsNextMarketplaceAdmin', () => {
  it('should render successfully', () => {
    const { baseElement } = render(<R10cShellsNextMarketplaceAdmin />);
    expect(baseElement).toBeTruthy();
  });
});
