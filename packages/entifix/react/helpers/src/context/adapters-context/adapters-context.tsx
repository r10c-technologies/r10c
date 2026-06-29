import { type Context, createContext, useContext } from 'react';
// import { isEmpty } from '@r10c/utils-ts-object';

export function createAdaptersContext<TAdapters>() {
  return createContext({} as TAdapters);
}

export function useAdaptersContext<TAdapters>(context: Context<TAdapters>) {
  const contextValue = useContext(context);
  // if (isEmpty(contextValue)) {
  //   throw new EntifixBuildError(
  //     'Adapters context is empty. Make sure to wrap your component tree with the appropriate AdaptersProvider.'
  //   );
  // }
  return contextValue;
}
