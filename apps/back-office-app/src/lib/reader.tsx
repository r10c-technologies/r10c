'use client';

import { createContext, type PropsWithChildren, useContext } from 'react';

/**
 * What the back office knows about who is reading, beyond the copy
 * `partyRole` picks: which other slices' regions a page may compose for them.
 *
 * Decided on the server, from the same two ceilings the sidebar applies
 * (`isNavItemVisible`), and read from the **unverified** access cookie — so it
 * shapes what a page *shows* and decides nothing: the service behind a region
 * still verifies the session and answers `403` (ADR 0077 §3).
 */
export interface Reader {
  /** Whether the reader may see stock: they hold its read and are entitled to it. */
  readonly stockReadable: boolean;
}

const ReaderContext = createContext<Reader>({ stockReadable: false });

export function ReaderProvider({
  reader,
  children,
}: PropsWithChildren<{ reader: Reader }>) {
  return (
    <ReaderContext.Provider value={reader}>{children}</ReaderContext.Provider>
  );
}

/** The reader the layout resolved; nothing visible by default. */
export const useReader = (): Reader => useContext(ReaderContext);
