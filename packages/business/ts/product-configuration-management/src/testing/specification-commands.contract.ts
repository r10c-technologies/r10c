import { EntifixBuildError } from '@entifix/core';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { SpecificationCommands } from '../ports/offering-catalog';

const TXN = '0b9a7c1e-4a1f-4c8e-9d1e-1f2a3b4c5d6e';

const command = (
  payload: Record<string, unknown> | undefined,
  entity = 'product-specification',
) => ({
  meta: { type: 'command', entity },
  data: { transactionId: TXN, type: 'create', entity, payload },
});

/**
 * What every {@link SpecificationCommands} must guarantee, through the port
 * alone: a well-formed create is accepted under the transaction id its client
 * minted (ADR 0028), the same command accepted twice answers the same id, and
 * what could never be written — no envelope, another entity, no name, media
 * that is not HTTPS — is refused before anything is accepted.
 *
 * `make` returns a fresh subject. Whether the accepted write then lands is the
 * transaction engine's to report, over the bus, and not this port's.
 */
export const describeSpecificationCommandsContract = (
  name: string,
  make: () => SpecificationCommands | Promise<SpecificationCommands>,
) => {
  describe(`${name} honours the SpecificationCommands contract`, () => {
    it('accepts a create under its own transaction id, twice alike', async () => {
      const commands = await make();
      const body = command({ name: 'A widget' });

      const first = await Effect.runPromise(commands.accept('acme', body));
      const again = await Effect.runPromise(commands.accept('acme', body));

      expect([first, again]).toEqual([
        { transactionId: TXN },
        { transactionId: TXN },
      ]);
    });

    it('refuses what could never be written', async () => {
      const commands = await make();

      const refusals = await Promise.all(
        [
          { not: 'an envelope' },
          command({ name: 'x' }, 'product-offering'),
          command({}),
          command({
            name: 'x',
            media: [{ url: 'http://cdn.example/a.jpg', alt: 'A' }],
          }),
          command(undefined),
        ].map(body =>
          Effect.runPromise(Effect.flip(commands.accept('acme', body))),
        ),
      );

      expect(refusals.every(error => error instanceof EntifixBuildError)).toBe(
        true,
      );
    });
  });
};
