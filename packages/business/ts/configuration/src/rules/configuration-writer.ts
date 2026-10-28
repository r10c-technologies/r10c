import type { EntityId, TransitionalFailure } from '@entifix/core';
import { Context, type Effect } from 'effect';

import type { Configuration } from '../entities/configuration';

/** Who made a change, from the verified principal — never from the request. */
export interface ConfigurationActor {
  readonly userId: EntityId;
  readonly subject: string;
}

/** A save refused by the write-only rule, with the code a client translates. */
export class ConfigurationWriteRefused {
  readonly _tag = 'ConfigurationWriteRefused';
  constructor(readonly code: string) {}
}

/**
 * Every write to the `configuration` store, audited.
 *
 * A port rather than the generic save, because a write here is two facts that
 * commit together — the row and its audit entry, which names the actor — and a
 * repository's `save` is told neither who acted nor that anything else must
 * happen with it.
 */
export interface ConfigurationWriter {
  /** Create or update, under `decideSecretWrite`; answers the row blanked. */
  readonly save: (
    incoming: Configuration,
    actor: ConfigurationActor,
  ) => Effect.Effect<
    Configuration,
    ConfigurationWriteRefused | TransitionalFailure
  >;
  /** Delete; answers `false` when there was no such row. */
  readonly delete: (
    id: EntityId,
    actor: ConfigurationActor,
  ) => Effect.Effect<boolean, TransitionalFailure>;
}

export class ConfigurationWriterTag extends Context.Service<
  ConfigurationWriterTag,
  ConfigurationWriter
>()('ConfigurationWriterTag') {}
