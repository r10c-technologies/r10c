import { getServerT } from '@entifix/next-i18n/server';
import {
  HeadingOne,
  Stack,
  SummaryTileList,
  Text,
} from '@entifix/react-controls';
import { DispatchTile } from '@r10c/shells-next-fulfilment';
import { BalanceTile } from '@r10c/shells-next-settlement';
import { OutOfStockTile } from '@r10c/shells-next-stock';
import type { ReactElement } from 'react';

import { homeTiles } from '../../../lib/home-tiles';
import { navPrincipal } from '../../../lib/nav-principal';

/**
 * Where the proxy lands an authenticated visitor: what needs their attention
 * today, each count one activation from where it is resolved (#563).
 *
 * The home has no screen type and writes nothing (ADR 0077 §1). Each tile is
 * its own slice shell's, reading through that shell's own adapter; this page
 * only decides which ones the reader is shown and lays them out. A tile whose
 * read fails says so in place, with Retry, and leaves the others standing.
 */
export default async function AdminHomePage() {
  const t = await getServerT('app');
  const shown = homeTiles(await navPrincipal());

  const tiles: readonly ReactElement[] = [
    ...(shown.dispatch ? [<DispatchTile key="dispatch" />] : []),
    ...(shown.outOfStock ? [<OutOfStockTile key="out-of-stock" />] : []),
    ...(shown.balance ? [<BalanceTile key="balance" />] : []),
  ];

  return (
    <Stack gap="s">
      <HeadingOne>{t('admin.nav.dashboard')}</HeadingOne>
      {tiles.length === 0 ? (
        <Text muted>{t('admin.home.none')}</Text>
      ) : (
        <SummaryTileList aria-label={t('admin.home.tiles')}>
          {tiles}
        </SummaryTileList>
      )}
    </Stack>
  );
}
