import { render } from '@testing-library/react';

import R10cEntifixReactHelpers from './entifix-react-helpers';

describe('R10cEntifixReactHelpers', () => {
  it('should render successfully', () => {
    const { baseElement } = render(<R10cEntifixReactHelpers />);
    expect(baseElement).toBeTruthy();
  });
});
