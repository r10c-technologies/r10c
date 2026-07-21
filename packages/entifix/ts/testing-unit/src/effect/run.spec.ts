import { ConfigurationRepositoryTag } from '@r10c/entifix-ts-business';
import { EntifixConnError } from '@r10c/entifix-ts-core';
import { Effect, Exit, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import { stubConfigurationLayer, stubUriConfigurationLayer } from '../doubles/configuration';
import {
  expectFailure,
  run,
  runFailure,
  runRepository,
  runRepositoryExit,
  runUC,
} from './run';

const failure = new EntifixConnError('unreachable');

/** An Effect that needs the configuration tag, as every repository method does. */
const needsConfiguration = Effect.gen(function* () {
  const store = yield* ConfigurationRepositoryTag;
  return yield* store.in('uri').getString('service');
});

describe('runUC', () => {
  it('provides the layer and returns the value', async () => {
    expect(
      await runUC(
        needsConfiguration,
        stubUriConfigurationLayer({ service: 'http://svc' }, { keyTemplate: '[entity]', group: 'uri' }),
      ),
    ).toBe('http://svc');
  });
});

// Asserting on the error *value* is the point: "it failed with the
// EntifixLockError the facade turns into a 409" beats "a promise rejected".
describe('expectFailure', () => {
  it('returns the typed error', async () => {
    const error = await expectFailure(
      Effect.fail(failure),
      Layer.succeed(ConfigurationRepositoryTag, {} as never),
    );

    expect(error).toBe(failure);
  });

  it('complains when the effect succeeded instead', async () => {
    await expect(
      expectFailure(
        Effect.succeed('fine'),
        Layer.succeed(ConfigurationRepositoryTag, {} as never),
      ),
    ).rejects.toThrow(/succeeded with: "fine"/);
  });

  // A defect is not a typed failure — reporting it as one would hide a bug in
  // the code under test behind an assertion that looks satisfied.
  it('complains when the effect died instead', async () => {
    await expect(
      expectFailure(
        Effect.die(new Error('boom')),
        Layer.succeed(ConfigurationRepositoryTag, {} as never),
      ),
    ).rejects.toThrow(/died with/);
  });
});

describe('runRepository', () => {
  it('discharges the configuration requirement with a stub by default', async () => {
    expect(
      await runRepository(Effect.succeed('value') as Effect.Effect<string, never, ConfigurationRepositoryTag>),
    ).toBe('value');
  });

  it('accepts an explicit configuration', async () => {
    expect(
      await runRepository(
        needsConfiguration,
        stubUriConfigurationLayer({ service: 'http://svc' }, { keyTemplate: '[entity]', group: 'uri' }),
      ),
    ).toBe('http://svc');
  });

  it('surfaces a failure through the stub configuration', async () => {
    const exit = await runRepositoryExit(
      Effect.fail(failure) as Effect.Effect<never, EntifixConnError, ConfigurationRepositoryTag>,
    );

    expect(Exit.isFailure(exit)).toBe(true);
  });

  it('accepts an explicit configuration for the exit variant', async () => {
    const exit = await runRepositoryExit(needsConfiguration, stubConfigurationLayer());

    expect(Exit.isFailure(exit)).toBe(true);
  });
});

describe('run', () => {
  it('runs an Effect that requires nothing', async () => {
    expect(await run(Effect.succeed(7))).toBe(7);
  });
});

describe('runFailure', () => {
  it('returns the typed error', async () => {
    expect(await runFailure(Effect.fail(failure))).toBe(failure);
  });

  it('complains when the effect succeeded instead', async () => {
    await expect(runFailure(Effect.succeed('fine'))).rejects.toThrow(
      /succeeded with: "fine"/,
    );
  });

  it('complains when the effect died instead', async () => {
    await expect(runFailure(Effect.die(new Error('boom')))).rejects.toThrow(
      /died with/,
    );
  });
});
