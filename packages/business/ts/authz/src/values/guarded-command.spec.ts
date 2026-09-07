import { describe, expect, it } from 'vitest';

import { NEW_COMMAND_PAGE } from './guarded-command.js';

describe('NEW_COMMAND_PAGE', () => {
  /**
   * Pinned because the two halves that must agree about it live in different
   * packages and never meet: a domain shell writes it onto a `GuardedCommand`,
   * and the palette synthesizes the root entry that opens the page of that name.
   * Nothing else would notice a typo — the page would simply be unreachable,
   * with every command still declared, still granted, and still passing every
   * `@r10c/slices` invariant.
   */
  it('is the id both halves of the page stack agree on', () => {
    expect(NEW_COMMAND_PAGE).toBe('new');
  });
});
