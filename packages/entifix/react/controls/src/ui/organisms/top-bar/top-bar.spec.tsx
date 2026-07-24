import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TopBar } from './top-bar.js';

describe('TopBar', () => {
  it('renders its slots as a banner', () => {
    render(
      <TopBar>
        <TopBar.Brand>r10c</TopBar.Brand>
        <TopBar.Context>marketplace-admin</TopBar.Context>
        <TopBar.Actions>
          <button type="button">Menu</button>
        </TopBar.Actions>
      </TopBar>,
    );

    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByText('r10c')).toBeInTheDocument();
    expect(screen.getByText('marketplace-admin')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Menu' })).toBeInTheDocument();
  });

  it('merges a caller className', () => {
    render(<TopBar className="custom-bar">x</TopBar>);
    expect(screen.getByRole('banner').className).toContain('custom-bar');
  });
});
