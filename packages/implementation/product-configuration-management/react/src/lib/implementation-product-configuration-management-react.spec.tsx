import { render } from '@testing-library/react';

import R10cImplementationProductConfigurationManagementReact from './implementation-product-configuration-management-react';

describe('R10cImplementationProductConfigurationManagementReact', () => {
  it('should render successfully', () => {
    const { baseElement } = render(
      <R10cImplementationProductConfigurationManagementReact />
    );
    expect(baseElement).toBeTruthy();
  });
});
