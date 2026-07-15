import { ThemeProvider } from '@r10c/entifix-react-controls';
import { render } from '@testing-library/react';
import React from 'react';

import Page from '../src/app/page';

// The root page is the design-system playground — it only needs theme context
// (not the REST adapters), so wrap in ThemeProvider directly.
describe('Page', () => {
  it('should render successfully', () => {
    const { baseElement } = render(
      <ThemeProvider themes={[{ id: 'admin', label: 'Admin' }]} defaultTheme="admin">
        <Page />
      </ThemeProvider>
    );
    expect(baseElement).toBeTruthy();
  });
});
