import { render } from '@testing-library/react';

import R10cShellsNextCommon from './shells-next-common';

describe('R10cShellsNextCommon', () => {
  it('should render successfully', () => {
    const { baseElement } = render(<R10cShellsNextCommon />);
    expect(baseElement).toBeTruthy();
  });
});
