import { EntifixBuildError } from '@entifix/core';
import { type Context, createContext, useContext } from 'react';

export function createAdaptersContext<TAdapters>() {
  return createContext({} as TAdapters);
}

export function useAdaptersContext<TAdapters>(context: Context<TAdapters>) {
  const contextValue = useContext(context);
  // The default `createAdaptersContext` hands out is `{}`, so "nobody mounted
  // a provider" and "the object has no keys" are the same question. Asked
  // directly rather than through a generic `isEmpty`: that helper also answers
  // for strings, arrays and null, none of which can reach here, and it was the
  // single import crossing out of entifix.
  if (Object.keys(contextValue as object).length === 0) {
    throw new EntifixBuildError(
      'Adapters context is empty. Make sure to wrap your component tree with the appropriate AdaptersProvider.',
    );
  }
  return contextValue;
}
