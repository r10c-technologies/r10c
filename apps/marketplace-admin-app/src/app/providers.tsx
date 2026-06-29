'use client';

import type { PropsWithChildren } from 'react';
import {
  MarketplaceAdminAdaptersProvider,
  createClientAdapters,
} from '@r10c/shells-next-marketplace-admin';

export function Providers({ children }: PropsWithChildren) {
  const adapters = createClientAdapters();

  return (
    <MarketplaceAdminAdaptersProvider adapters={adapters}>
      {children}
    </MarketplaceAdminAdaptersProvider>
  );
}
