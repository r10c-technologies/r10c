'use client';

import {
  createClientAdapters,
  MarketplaceAdminAdaptersProvider,
} from '@r10c/shells-next-marketplace-admin';
import type { PropsWithChildren } from 'react';

export function Providers({ children }: PropsWithChildren) {
  const adapters = createClientAdapters();

  return (
    <MarketplaceAdminAdaptersProvider adapters={adapters}>
      {children}
    </MarketplaceAdminAdaptersProvider>
  );
}
