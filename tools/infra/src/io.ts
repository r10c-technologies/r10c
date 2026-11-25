/**
 * Everything the up and down commands do to the world goes through one
 * interface, so the spec can record what a run would execute — and assert
 * that the way down never names a destructive verb — and `--dry-run` can
 * print it without touching a cluster.
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface RunOptions {
  /** Written to the command's stdin: how a secret reaches `kubectl` or `gcloud` without its argv. */
  readonly input?: string;
  readonly env?: Readonly<Record<string, string>>;
  /** Return stdout rather than streaming it. */
  readonly capture?: boolean;
  /** A failure is an answer (`{ ok: false }`) rather than an exception. */
  readonly allowFailure?: boolean;
  /** Indexes into argv whose value is a secret, masked in the log. */
  readonly secretArgs?: readonly number[];
}

export interface RunResult {
  readonly ok: boolean;
  readonly stdout: string;
}

export interface Background {
  readonly stop: () => void;
}

export interface Io {
  readonly run: (argv: readonly string[], options?: RunOptions) => RunResult;
  /**
   * A process kept running beside the next steps: a port-forward. It is
   * dialled again whenever it exits, until stopped: `kubectl port-forward`
   * holds one pod, so a broker restarted or a deployment rolled would
   * otherwise leave its port dead for the rest of the run.
   */
  readonly background: (argv: readonly string[]) => Background;
  readonly log: (message: string) => void;
  readonly write: (path: string, text: string) => void;
  readonly read: (path: string) => string | undefined;
  readonly sleep: (ms: number) => void;
}

/** How a command is shown: secrets masked, nothing else changed. */
export const shown = (
  argv: readonly string[],
  secretArgs: readonly number[] = [],
): string =>
  argv
    .map((arg, index) => (secretArgs.includes(index) ? '••••' : arg))
    .join(' ');

/** The real world. */
export const realIo = (cwd: string): Io => ({
  run: (argv, options = {}) => {
    const [command = '', ...args] = argv;
    console.log(`  $ ${shown(argv, options.secretArgs)}`);
    try {
      const stdout = execFileSync(command, args, {
        cwd,
        input: options.input,
        env: { ...process.env, ...options.env },
        encoding: 'utf8',
        maxBuffer: 256 * 1024 * 1024,
        stdio: [
          options.input === undefined ? 'ignore' : 'pipe',
          options.capture === true ? 'pipe' : 'inherit',
          options.allowFailure === true ? 'pipe' : 'inherit',
        ],
      });
      return { ok: true, stdout: stdout ?? '' };
    } catch (error) {
      if (options.allowFailure === true) return { ok: false, stdout: '' };
      throw error;
    }
  },
  background: argv => {
    const [command = '', ...args] = argv;
    console.log(`  $ ${shown(argv)} &`);
    let stopped = false;
    let child = spawn(command, args, { cwd, stdio: 'ignore' });
    const redial = () => {
      if (stopped) return;
      setTimeout(() => {
        if (stopped) return;
        console.log(`  $ ${shown(argv)} & (again)`);
        child = spawn(command, args, { cwd, stdio: 'ignore' });
        child.on('exit', redial);
      }, 1000);
    };
    child.on('exit', redial);
    return {
      stop: () => {
        stopped = true;
        child.kill();
      },
    };
  },
  log: message => {
    console.log(message);
  },
  write: (path, text) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, { mode: 0o600 });
  },
  read: path => {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return undefined;
    }
  },
  sleep: ms => {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  },
});

/**
 * A run that changes nothing: read-only local commands (`kubectl kustomize`,
 * `git rev-parse`) run for real, so the printed plan shows the real stages;
 * everything else is printed and answered from `answer`.
 */
export const dryRunIo = (
  cwd: string,
  answer: (argv: readonly string[]) => string,
): Io => {
  const real = realIo(cwd);
  const readOnly = (argv: readonly string[]) =>
    (argv[0] === 'kubectl' && argv[1] === 'kustomize') ||
    (argv[0] === 'git' && argv[1] === 'rev-parse');
  return {
    ...real,
    run: (argv, options = {}) => {
      if (readOnly(argv)) return real.run(argv, { ...options, capture: true });
      console.log(`  [dry-run] ${shown(argv, options.secretArgs)}`);
      return { ok: true, stdout: answer(argv) };
    },
    background: argv => {
      console.log(`  [dry-run] ${shown(argv)} &`);
      return { stop: () => undefined };
    },
    // The overlay is generated and gitignored, and rendering it is how the
    // printed plan shows the real stages; nothing else is written.
    write: (path, text) => {
      if (path.includes('/infra/.overlay/')) real.write(path, text);
      else console.log(`  [dry-run] write ${path}`);
    },
    sleep: () => undefined,
  };
};
