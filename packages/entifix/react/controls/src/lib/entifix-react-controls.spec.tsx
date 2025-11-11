import { render } from '@testing-library/react';

import R10cEntifixReactControls from './entifix-react-controls';

describe('R10cEntifixReactControls', () => {
  it('should render successfully', () => {
    const { baseElement } = render(<R10cEntifixReactControls />);
    expect(baseElement).toBeTruthy();
  });
});
