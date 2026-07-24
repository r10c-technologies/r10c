import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Tab, TabAddButton, TabStrip } from './tab-strip.js';

describe('TabStrip', () => {
  it('renders a tablist wrapper', () => {
    render(
      <TabStrip>
        <Tab label="Products" />
      </TabStrip>,
    );
    expect(screen.getByRole('tablist')).toBeInTheDocument();
  });
});

describe('Tab', () => {
  it('marks the active tab and shows its accent bar', () => {
    render(<Tab label="Products" active />);
    const tab = screen.getByRole('tab');

    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(tab.className).toContain('bg-surface-elevated');
  });

  it('is unselected by default with no indicator', () => {
    render(<Tab label="Brands" />);

    expect(screen.getByRole('tab')).toHaveAttribute('aria-selected', 'false');
    expect(screen.queryByTestId('tab-indicator')).not.toBeInTheDocument();
  });

  it('selects on click', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<Tab label="Products" onSelect={onSelect} />);

    await user.click(screen.getByText('Products'));

    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('shows a static dot when dirty', () => {
    render(<Tab label="Acme" state="dirty" />);
    const dot = screen.getByTestId('tab-indicator');

    expect(dot.className).toContain('bg-accent');
    expect(dot.className).not.toContain('animate-pulse');
  });

  it('breathes the dot while saving', () => {
    render(<Tab label="Acme" state="saving" />);
    expect(screen.getByTestId('tab-indicator').className).toContain('animate-pulse');
  });

  it('turns the tab and dot to danger on error', () => {
    render(<Tab label="Acme" state="error" />);

    expect(screen.getByRole('tab').className).toContain('bg-danger-subtle');
    expect(screen.getByTestId('tab-indicator').className).toContain('bg-danger');
  });

  it('renders a close button that fires onClose', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<Tab label="Products" onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'Close Products' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('omits the close button when no handler is given', () => {
    render(<Tab label="Products" />);
    expect(
      screen.queryByRole('button', { name: /close/i }),
    ).not.toBeInTheDocument();
  });

  it('keeps the close button visible on the active tab', () => {
    render(<Tab label="Products" active onClose={() => undefined} />);
    expect(
      screen.getByRole('button', { name: 'Close Products' }).className,
    ).toContain('opacity-100');
  });
});

describe('TabAddButton', () => {
  it('fires when clicked', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<TabAddButton onClick={onClick} />);

    await user.click(screen.getByRole('button', { name: 'Open a new tab' }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
