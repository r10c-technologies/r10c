import { useUiPreference } from '@r10c/entifix-react-controls';
import { Effect } from 'effect';
import { createContext, useContext } from 'react';
import { describe, expect, it } from 'vitest';

import { renderWithAdapters, screen, waitFor } from './render';
import { makeInMemoryUiPreferencesStore } from './ui-preferences';

describe('makeInMemoryUiPreferencesStore', () => {
  it('round-trips a value', async () => {
    const store = makeInMemoryUiPreferencesStore();

    await Effect.runPromise(store.write('table:product', { order: ['id'] }));

    expect(await Effect.runPromise(store.read('table:product'))).toEqual({
      order: ['id'],
    });
  });

  it('resolves an unknown key as absent', async () => {
    expect(
      await Effect.runPromise(makeInMemoryUiPreferencesStore().read('absent')),
    ).toBeUndefined();
  });

  it('removes a value', async () => {
    const store = makeInMemoryUiPreferencesStore({ 'table:product': 1 });

    await Effect.runPromise(store.remove('table:product'));

    expect(await Effect.runPromise(store.read('table:product'))).toBeUndefined();
  });

  it('starts from the seed it was given', async () => {
    const store = makeInMemoryUiPreferencesStore({ 'table:product': 1 });

    expect(await Effect.runPromise(store.read('table:product'))).toBe(1);
  });

  // `entries` is what a spec asserts personalization against, keyed exactly as
  // the control wrote it.
  it('exposes everything currently stored', async () => {
    const store = makeInMemoryUiPreferencesStore();

    await Effect.runPromise(store.write('a', 1));

    expect(store.entries).toEqual({ a: 1 });
  });

  it('reseeds wholesale, dropping what was there', async () => {
    const store = makeInMemoryUiPreferencesStore({ a: 1 });

    store.seed({ b: 2 });

    expect(store.entries).toEqual({ b: 2 });
  });

  it('copies the seed rather than aliasing it', () => {
    const seed = { a: 1 };
    const store = makeInMemoryUiPreferencesStore(seed);

    store.seed({ b: 2 });

    expect(seed).toEqual({ a: 1 });
    expect(store.entries).not.toBe(seed);
  });
});

interface Adapters {
  productRest: string;
}

const AdaptersContext = createContext<Adapters>({} as Adapters);

const ShowAdapter = () => <span>{useContext(AdaptersContext).productRest}</span>;

const ShowPreference = () => {
  const { value, isReady } = useUiPreference('table:product', 'default');
  return <span>{isReady ? String(value) : 'loading'}</span>;
};

describe('renderWithAdapters', () => {
  // Components reach their adapters through context and their personalization
  // through the preferences provider; rendering without those is testing a
  // configuration that never ships.
  it('publishes the adapters it was given', () => {
    renderWithAdapters(<ShowAdapter />, {
      adapters: { context: AdaptersContext, value: { productRest: 'rest' } },
    });

    expect(screen.getByText('rest')).toBeInTheDocument();
  });

  it('renders without adapters when a component needs none', () => {
    renderWithAdapters(<span>Bare</span>);

    expect(screen.getByText('Bare')).toBeInTheDocument();
  });

  // A fresh store per render is what keeps one test's personalization from
  // leaking into the next.
  it('defaults to a fresh in-memory preferences store', async () => {
    const first = renderWithAdapters(<ShowPreference />);
    await waitFor(() => expect(screen.getByText('default')).toBeInTheDocument());
    await Effect.runPromise(first.preferences.write('table:product', 'stored'));

    const second = renderWithAdapters(<ShowPreference />);

    expect(second.preferences).not.toBe(first.preferences);
  });

  it('uses the preferences store it was given', async () => {
    const preferences = makeInMemoryUiPreferencesStore({
      'table:product': 'stored',
    });

    const view = renderWithAdapters(<ShowPreference />, { preferences });

    await waitFor(() => expect(screen.getByText('stored')).toBeInTheDocument());
    expect(view.preferences).toBe(preferences);
  });

  it('hands back the store the tree rendered against', () => {
    expect(renderWithAdapters(<span>Bare</span>).preferences).toBeDefined();
  });
});
