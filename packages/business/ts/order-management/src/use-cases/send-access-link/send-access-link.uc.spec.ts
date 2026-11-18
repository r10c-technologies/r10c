import { describe, expect, it } from 'vitest';

import { SEND_ACCESS_LINK } from './send-access-link.uc.js';

describe('SendAccessLinkUC', () => {
  it('derives its permission from the group and its own key', () => {
    expect(SEND_ACCESS_LINK).toBe(
      'order-management:checkout-group:send-access-link',
    );
  });
});
