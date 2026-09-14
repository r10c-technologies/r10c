import type { PendingEntry } from '@r10c/entifix-transactions';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { PendingNotice } from './pending-notice.js';

const anEntry = (
  transactionId: string,
  state: PendingEntry['state'],
  reason?: string,
): PendingEntry => ({
  transactionId,
  entity: 'widget',
  at: '2026-09-02T00:00:00.000Z',
  state,
  reason,
});

describe('PendingNotice', () => {
  // Nothing in flight is not a state to announce — an empty status region is
  // still a landmark a screen reader stops on.
  it('renders nothing when there is nothing to report', () => {
    const { container } = render(
      <PendingNotice entries={[]} onDismiss={vi.fn()} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('counts the writes still in flight', () => {
    render(
      <PendingNotice
        entries={[anEntry('a', 'pending'), anEntry('b', 'pending')]}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.getByTestId('pending-notice')).toHaveTextContent('2');
  });

  it('names each failure and offers to retire it', async () => {
    const onDismiss = vi.fn();
    render(
      <PendingNotice
        entries={[anEntry('a', 'failed', 'duplicate code')]}
        onDismiss={onDismiss}
      />,
    );

    expect(screen.getByTestId('pending-notice-reason')).toHaveTextContent(
      'duplicate code',
    );

    await userEvent.click(screen.getByRole('button'));

    expect(onDismiss).toHaveBeenCalledWith('a');
  });

  // A transaction can fail with no `error` at all — `STALE` is applied by the
  // recovery sweep and carries none — so the headline has to stand alone.
  it('reports a failure that carries no reason', () => {
    render(
      <PendingNotice entries={[anEntry('a', 'failed')]} onDismiss={vi.fn()} />,
    );

    expect(screen.queryByTestId('pending-notice-reason')).toBeNull();
    expect(screen.getByTestId('pending-notice')).toBeInTheDocument();
  });

  // Both at once is the ordinary case once a second write is started after one
  // has failed, and the two must not hide each other.
  it('shows a count and a failure together', () => {
    render(
      <PendingNotice
        entries={[anEntry('a', 'pending'), anEntry('b', 'failed', 'boom')]}
        onDismiss={vi.fn()}
      />,
    );

    const notice = screen.getByTestId('pending-notice');
    expect(notice).toHaveTextContent('1');
    expect(screen.getByTestId('pending-notice-reason')).toHaveTextContent(
      'boom',
    );
  });

  // An outcome to read, not an interruption — the `BulkResult` reasoning.
  it('is a status region rather than an alert', () => {
    render(
      <PendingNotice entries={[anEntry('a', 'pending')]} onDismiss={vi.fn()} />,
    );

    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
