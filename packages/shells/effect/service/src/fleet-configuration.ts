import {
  ConfigurationClientInMemory,
  type ConfigurationPlain,
} from '@entifix/core';

import type { FleetConfiguration } from './fleet-service.js';

/**
 * A service's configuration from its rows: what boot builds from the document
 * config-service served, and what a slice shell's spec builds from a literal
 * to compose against.
 */
export const fleetConfigurationOf = (
  plain: ConfigurationPlain,
): FleetConfiguration => ({
  plain,
  store: new ConfigurationClientInMemory(plain),
});

/** One group's rows from a record, for a spec's literal configuration. */
export const configurationRows = (group: Readonly<Record<string, unknown>>) =>
  Object.entries(group).map(([key, value]) => ({ key, value }));
