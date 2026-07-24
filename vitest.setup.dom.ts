import '@testing-library/jest-dom/vitest';

import { TextDecoder, TextEncoder } from 'node:util';

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Tells React it is running under a test renderer, so state updates outside
// `act()` are batched rather than warned about.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// jsdom does not implement these, and `effect` imports them.
globalThis.TextEncoder ??= TextEncoder as typeof globalThis.TextEncoder;
globalThis.TextDecoder ??= TextDecoder as typeof globalThis.TextDecoder;

/**
 * Node 26 defines its own `localStorage` global, which is inert unless the
 * process was started with `--localstorage-file`. It shadows the one jsdom
 * installs, so `window.localStorage` is `undefined` inside the jsdom
 * environment. Install a spec-compliant in-memory Storage instead.
 */
class MemoryStorage implements Storage {
  #entries = new Map<string, string>();

  get length(): number {
    return this.#entries.size;
  }

  key(index: number): string | null {
    return [...this.#entries.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    return this.#entries.get(String(key)) ?? null;
  }

  setItem(key: string, value: string): void {
    this.#entries.set(String(key), String(value));
  }

  removeItem(key: string): void {
    this.#entries.delete(String(key));
  }

  clear(): void {
    this.#entries.clear();
  }
}

if (typeof globalThis.localStorage?.getItem !== 'function') {
  Object.defineProperty(globalThis, 'localStorage', {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
  });
}
if (typeof globalThis.sessionStorage?.getItem !== 'function') {
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
  });
}

// Headless UI's overlay components (Menu/Listbox panels) observe their trigger
// with a ResizeObserver, which jsdom does not implement. A no-op keeps them
// from throwing when opened in a test.
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
} as typeof globalThis.ResizeObserver;

// React Testing Library does not auto-clean when `globals` are provided by a
// setup file rather than by its own auto-cleanup entrypoint.
afterEach(cleanup);
