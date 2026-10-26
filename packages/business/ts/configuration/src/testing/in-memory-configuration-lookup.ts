import { Effect } from 'effect';

import {
  type ConfigurationLookup,
  toConfigurationPlain,
} from '../rules/configuration-lookup';
import type { ServiceRow } from './configuration-lookup.contract';

/**
 * A {@link ConfigurationLookup} over rows held in memory, for the specs of
 * whatever serves configuration. It runs `describeConfigurationLookupContract`.
 */
export const makeInMemoryConfigurationLookup = (
  rows: readonly ServiceRow[] = [],
): ConfigurationLookup => ({
  forService: service =>
    Effect.sync(() =>
      toConfigurationPlain(rows.filter(row => row.service === service)),
    ),
  stats: () =>
    Effect.sync(() => ({
      rowCount: rows.length,
      services: Array.from(new Set(rows.map(row => row.service))).sort(),
    })),
});
