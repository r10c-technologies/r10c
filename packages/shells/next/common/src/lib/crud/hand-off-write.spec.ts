import type { PendingTransactionStore } from '@r10c/entifix-transactions';
import { describe, expect, it, vi } from 'vitest';

import { handOffWrite } from './hand-off-write.js';

const store = (attached: boolean) =>
  ({
    began: vi.fn(),
    entries: [],
    attach: vi.fn(() => attached),
    settle: vi.fn(),
    fail: vi.fn(),
    dismiss: vi.fn(),
  }) satisfies PendingTransactionStore;

describe('handOffWrite', () => {
  it('offers the record to the pending set and says the write is in flight', () => {
    const pending = store(true);
    const draft = { clear: vi.fn() };

    expect(
      handOffWrite({ id: 'p-1', record: { id: 'p-1' }, pending, draft }),
    ).toBe(true);
    expect(pending.attach).toHaveBeenCalledWith('p-1', { id: 'p-1' });
  });

  it('keeps the draft while the write is still in flight', () => {
    // The write has not committed. A failure minutes from now would otherwise
    // have destroyed the operator's only copy of what they typed.
    const draft = { clear: vi.fn() };

    handOffWrite({ id: 'p-1', record: {}, pending: store(true), draft });

    expect(draft.clear).not.toHaveBeenCalled();
  });

  it('spends the draft once the write has plainly committed', () => {
    const draft = { clear: vi.fn() };

    expect(
      handOffWrite({ id: 'p-1', record: {}, pending: store(false), draft }),
    ).toBe(false);
    expect(draft.clear).toHaveBeenCalledOnce();
  });

  it('works for a screen that holds no draft at all', () => {
    expect(
      handOffWrite({ id: 'p-1', record: {}, pending: store(false) }),
    ).toBe(false);
  });
});
