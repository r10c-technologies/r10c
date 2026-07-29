import { render } from '@testing-library/react';
import React from 'react';
import { vi } from 'vitest';

// The page resolves its own copy on the server; the catalog is covered in
// `@r10c/entifix-ts-i18n`, so the key is echoed back here.
vi.mock('@r10c/shells-next-i18n/server', () => ({
  getServerT: () => Promise.resolve((key: string) => key),
}));

import Page from '../src/app/(authenticated)/home/page';

// `/` redirects to `/<locale>/home`, so the page under `(authenticated)/home`
// is what a visitor actually lands on. It is an async server component: await
// it and render what it returns.
describe('AdminHomePage', () => {
  it('should render successfully', async () => {
    const { baseElement } = render(await Page());

    expect(baseElement).toBeTruthy();
  });
});
