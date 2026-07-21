import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Card } from './card.js';

describe('Card', () => {
  it('renders its children on an elevated surface', () => {
    render(<Card data-testid="card">Contents</Card>);

    expect(screen.getByTestId('card')).toHaveTextContent('Contents');
    expect(screen.getByTestId('card').className).toContain('bg-surface-elevated');
  });

  it('keeps the caller’s className alongside its own', () => {
    render(<Card data-testid="card" className="custom" />);

    const classes = screen.getByTestId('card').className.split(/\s+/);
    expect(classes).toEqual(expect.arrayContaining(['custom', 'rounded-2xl']));
  });

  it('forwards div props through', () => {
    render(<Card data-testid="card" role="group" aria-label="Summary" />);

    expect(screen.getByRole('group')).toHaveAccessibleName('Summary');
  });
});
