import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  describeCatalogImportCommandsContract,
  importedRowOf,
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
});
