import {
  UiPreferencesProvider,
  type UiPreferencesStore,
} from '@r10c/entifix-react-controls';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import type { Context, PropsWithChildren, ReactElement } from 'react';

import { makeInMemoryUiPreferencesStore } from './ui-preferences';

export interface RenderWithAdaptersOptions<TAdapters>
  extends Omit<RenderOptions, 'wrapper'> {
  /**
   * The adapters context a shell would normally provide, paired with the value
   * to publish on it.
   */
  adapters?: { context: Context<TAdapters>; value: TAdapters };
  /** Defaults to a fresh in-memory store, so personalization never leaks. */
  preferences?: UiPreferencesStore;
}

export interface RenderWithAdaptersResult extends RenderResult {
  /** The preferences store the tree rendered against. */
  preferences: UiPreferencesStore;
}

/**
 * Renders a component with the providers a real page would mount around it.
 *
 * Components reach their adapters through context and their personalization
 * through {@link UiPreferencesProvider}; rendering without those is testing a
 * configuration that never ships.
 */
export const renderWithAdapters = <TAdapters,>(
  ui: ReactElement,
  {
    adapters,
    preferences = makeInMemoryUiPreferencesStore(),
    ...options
  }: RenderWithAdaptersOptions<TAdapters> = {},
): RenderWithAdaptersResult => {
  const Wrapper = ({ children }: PropsWithChildren) => {
    const withPreferences = (
      <UiPreferencesProvider store={preferences}>
        {children}
      </UiPreferencesProvider>
    );

    if (adapters === undefined) return withPreferences;

    const { context: AdaptersContext, value } = adapters;
    return (
      <AdaptersContext.Provider value={value}>
        {withPreferences}
      </AdaptersContext.Provider>
    );
  };

  return {
    ...render(ui, { wrapper: Wrapper, ...options }),
    preferences,
  };
};

export * from '@testing-library/react';
export { default as userEvent } from '@testing-library/user-event';
