/**
 * Where secret values live: Secret Manager in the cloud (ADR 0083), a
 * gitignored file for the lab rehearsal. Values pass through `stdin`, never
 * through argv, on the way in.
 */
import type { Io } from './io.js';

export interface SecretStore {
  readonly get: (name: string) => string | undefined;
  readonly put: (name: string, value: string) => void;
}

export const secretManager = (
  io: Io,
  project: string,
  prefix: string,
): SecretStore => ({
  get: name => {
    const { ok, stdout } = io.run(
      [
        'gcloud',
        'secrets',
        'versions',
        'access',
        'latest',
        `--secret=${prefix}${name}`,
        `--project=${project}`,
      ],
      { capture: true, allowFailure: true },
    );
    return ok && stdout !== '' ? stdout : undefined;
  },
  put: (name, value) => {
    io.run(
      [
        'gcloud',
        'secrets',
        'versions',
        'add',
        `${prefix}${name}`,
        '--data-file=-',
        `--project=${project}`,
      ],
      { input: value, capture: true },
    );
  },
});

/** The lab's values, in one file only this machine holds (`infra/.overlay/lab/`). */
export const fileStore = (io: Io, path: string): SecretStore => {
  const load = (): Record<string, string> =>
    JSON.parse(io.read(path) ?? '{}') as Record<string, string>;
  return {
    get: name => load()[name],
    put: (name, value) => {
      io.write(
        path,
        `${JSON.stringify({ ...load(), [name]: value }, null, 2)}\n`,
      );
    },
  };
};
