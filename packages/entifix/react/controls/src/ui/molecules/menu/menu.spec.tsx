import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Menu } from './menu.js';

function Fixture({ onPick }: { onPick?: () => void }) {
  return (
    <Menu>
      <Menu.Trigger>Account</Menu.Trigger>
      <Menu.Items>
        <Menu.Item onClick={onPick}>Profile</Menu.Item>
        <Menu.Item disabled>Billing</Menu.Item>
      </Menu.Items>
    </Menu>
  );
}

describe('Menu', () => {
  it('keeps items hidden until the trigger is opened', () => {
    render(<Fixture />);

    expect(screen.getByText('Account')).toBeInTheDocument();
    expect(screen.queryByText('Profile')).not.toBeInTheDocument();
  });

  it('reveals items and fires the picked item', async () => {
    const onPick = vi.fn();
    const user = userEvent.setup();
    render(<Fixture onPick={onPick} />);

    await user.click(screen.getByText('Account'));
    await user.click(screen.getByText('Profile'));

    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it('renders a disabled item that cannot be picked', async () => {
    const user = userEvent.setup();
    render(<Fixture />);

    await user.click(screen.getByText('Account'));
    const billing = screen.getByText('Billing');

    expect(billing).toHaveAttribute('aria-disabled', 'true');
  });
});
