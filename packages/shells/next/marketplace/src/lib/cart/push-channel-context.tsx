'use client';

import { NoopPushChannel, type PushChannel } from '@entifix/react-integration';
import { createContext, type PropsWithChildren, useContext } from 'react';

const PushChannelContext = createContext<PushChannel>(NoopPushChannel);

/**
 * The tab's push channel, for a storefront island to listen on. The host
 * builds the one channel and hands it here and to the pending-flow store,
 * so the tab keeps one stream (ADR 0072).
 */
export function StorefrontPushProvider({
  channel,
  children,
}: PropsWithChildren<{ readonly channel: PushChannel }>) {
  return (
    <PushChannelContext.Provider value={channel}>
      {children}
    </PushChannelContext.Provider>
  );
}

/** The tab's push channel, or one that never connects when none was given. */
export const useStorefrontPushChannel = (): PushChannel =>
  useContext(PushChannelContext);
