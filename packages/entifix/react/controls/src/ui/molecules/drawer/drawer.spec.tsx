import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Drawer } from './drawer';

const renderDrawer = (
  props: Partial<Parameters<typeof Drawer>[0]> = {},
) => {
  const onClose = vi.fn();
  render(
    <Drawer
      open
      onClose={onClose}
      title="Acme Admin"
      closeLabel="Cerrar el menú"
      {...props}
    >
      <a href="/catalog/product">Products</a>
    </Drawer>,
  );
  return { onClose };
};

describe('Drawer', () => {
  it('names the dialog and renders its content', () => {
    renderDrawer();
    const drawer = screen.getByRole('dialog', { name: /Acme Admin/ });

    expect(
      within(drawer).getByRole('link', { name: 'Products' }),
    ).toBeInTheDocument();
  });

  it('renders nothing while closed', () => {
    renderDrawer({ open: false });

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes on the close control', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDrawer();

    await user.click(screen.getByRole('button', { name: 'Cerrar el menú' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on Escape', async () => {
    // The library's, not ours — which is the whole reason this is a `Dialog`
    // rather than a positioned div.
    const user = userEvent.setup();
    const { onClose } = renderDrawer();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('traps focus inside the panel', async () => {
    const user = userEvent.setup();
    renderDrawer();
    const drawer = screen.getByRole('dialog');

    await user.tab();
    expect(drawer).toContainElement(document.activeElement as HTMLElement);
  });

  it('accepts extra classes on the panel', () => {
    renderDrawer({ className: 'w-96' });

    expect(screen.getByTestId('drawer')).toHaveClass('w-96');
  });
});
