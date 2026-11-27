import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  describeCatalogImportCommandsContract,
  importedRowOf,
  updatedRowOf,
} from './catalog-import-commands.contract.js';
import { makeInMemoryCatalogImportCommands } from './in-memory-catalog-import.js';

describeCatalogImportCommandsContract('the in-memory catalog import', () =>
  makeInMemoryCatalogImportCommands(),
);

describe('the in-memory catalog import', () => {
  it('keeps what a sealed row announces', async () => {
    const commands = makeInMemoryCatalogImportCommands();
    const event = { type: 'catalog.published' } as never;

    await Effect.runPromise(
      commands.importRow(
        'acme',
        'k:2',
        importedRowOf('A', () => Effect.succeed(event)),
      ),
    );

    expect(commands.state.announced).toEqual([event]);
    expect(commands.state.rows).toHaveLength(1);
  });

  it('moves a record that had no revision, as a seeded one has none, and keeps what an update announces', async () => {
    const commands = makeInMemoryCatalogImportCommands();
    const created = importedRowOf('A');
    created.offering.revision = undefined;
    created.price.revision = undefined;
    const event = { type: 'catalog.published' } as never;

    const first = await Effect.runPromise(
      commands.updateRow('acme', 'u:2', updatedRowOf(created, { event })),
    );
    const second = await Effect.runPromise(
      commands.updateRow('acme', 'u:3', updatedRowOf(created)),
    );

    expect(first).toMatchObject({ change: 'update' });
    expect(second).toBe('changed');
    expect(commands.state.announced).toEqual([event]);
  });
});
