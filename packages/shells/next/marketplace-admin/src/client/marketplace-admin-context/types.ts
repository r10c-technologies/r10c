import type { ReactNode } from 'react';
import type { MarketplaceAdminAdapters } from '../client-types';

export interface MarketplaceAdminProviderProps {
  children: ReactNode;
  adapters: MarketplaceAdminAdapters;
}
