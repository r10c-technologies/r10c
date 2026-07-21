import { describe, expect, it } from 'vitest';

import { ServerPlaceholder } from './server.js';

// The server entry point exists so the shell has a place to export React
// server components from; nothing uses it yet.
describe('the server entry point', () => {
  it('exports its placeholder', () => {
    expect(ServerPlaceholder).toBe('Hello from the server!');
  });
});
