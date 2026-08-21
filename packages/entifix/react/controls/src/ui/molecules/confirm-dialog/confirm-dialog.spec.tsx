import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ConfirmDialog } from './confirm-dialog';

const props = {
  open: true,
  title: 'End all sessions',
  message: 'This signs the user out everywhere.',
  onConfirm: vi.fn(),
  onCancel: vi.fn(),
};

describe('ConfirmDialog', () => {
  it('renders nothing while closed', () => {
    render(<ConfirmDialog {...props} open={false} />);

    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
  });

  it('shows the caller-resolved copy and its own default buttons', () => {
    render(<ConfirmDialog {...props} />);

    expect(screen.getByText('End all sessions')).toBeInTheDocument();
    expect(
      screen.getByText('This signs the user out everywhere.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Confirmar' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Cancelar' }),
    ).toBeInTheDocument();
  });

  it('paints the confirm button in the danger tokens for a destructive act', () => {
    render(<ConfirmDialog {...props} tone="destructive" />);

    expect(screen.getByRole('button', { name: 'Confirmar' })).toHaveClass(
      'bg-danger',
    );
  });

  it('keeps a neutral act on the primary variant', () => {
    render(<ConfirmDialog {...props} tone="neutral" />);

    expect(screen.getByRole('button', { name: 'Confirmar' })).not.toHaveClass(
      'bg-danger',
    );
  });

  it('takes caller-supplied button labels', () => {
    render(
      <ConfirmDialog {...props} confirmLabel="End them" cancelLabel="Keep" />,
    );

    expect(
      screen.getByRole('button', { name: 'End them' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep' })).toBeInTheDocument();
  });

  it('reports the choice, and disables both while busy', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const { rerender } = render(
      <ConfirmDialog {...props} onConfirm={onConfirm} onCancel={onCancel} />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(onConfirm).toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onCancel).toHaveBeenCalled();

    rerender(
      <ConfirmDialog
        {...props}
        busy
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
  });
});
