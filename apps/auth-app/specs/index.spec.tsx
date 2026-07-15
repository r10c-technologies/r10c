import { render } from '@testing-library/react';
import React from 'react';

import Page from '../src/app/page';
import { Providers } from '../src/app/providers';

describe('Page', () => {
  it('should render successfully', () => {
    const { baseElement } = render(
      <Providers>
        <Page />
      </Providers>
    );
    expect(baseElement).toBeTruthy();
  });
});
