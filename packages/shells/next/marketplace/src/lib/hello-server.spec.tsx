import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { HelloServer } from './hello-server.js';

// A server component is async, so rendering it means awaiting the element it
// resolves to before handing it to the DOM.
describe('HelloServer', () => {
  it('renders its greeting', async () => {
    render(await HelloServer());

    expect(screen.getByRole('heading', { name: 'Hello Server' })).toBeInTheDocument();
  });
});
