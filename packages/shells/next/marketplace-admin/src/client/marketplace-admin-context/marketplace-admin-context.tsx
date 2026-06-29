import {
  useAdaptersContext,
  createAdaptersContext,
} from '@r10c/entifix-react-integration';
import type { MarketplaceAdminAdapters } from '../client-types';
import type { MarketplaceAdminProviderProps } from './types';

const MarketplaceAdminAdaptersContext =
  createAdaptersContext<MarketplaceAdminAdapters>();

export function MarketplaceAdminAdaptersProvider({
  adapters,
  children,
}: MarketplaceAdminProviderProps) {
  return (
    <MarketplaceAdminAdaptersContext.Provider value={adapters}>
      {children}
    </MarketplaceAdminAdaptersContext.Provider>
  );
}

export const useMarketplaceAdminAdapters = () =>
  useAdaptersContext(MarketplaceAdminAdaptersContext);
