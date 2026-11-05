#!/usr/bin/env node
// The Nx task cache, carried between CI jobs and runs by GitHub alone.
//
// Nx 24's local cache cannot simply be copied between runners: what it may
// replay is indexed in a SQLite file named after the machine
// (`.nx/workspace-data/<machine-id>-v6.db`), every runner is a fresh machine,
// and `NX_REJECT_UNKNOWN_LOCAL_CACHE=0` is not supported by that database
// cache. A restored `.nx/cache` is therefore ignored, with "Nx found
// unrecognized artifacts in the cache directory".
//
// Nx does ship a client for a self-hosted HTTP cache
// (`NX_SELF_HOSTED_REMOTE_CACHE_SERVER`), and that needs no index: an entry is
// a tarball addressed by its task hash. So each job runs this server on
// loopback over a plain directory, and the directory — one file per hash — is
// what `actions/cache` and the run's artifacts carry. Merging the entries of
// several jobs is copying files, because a name is its content's hash.
//
// Subcommands:
//   serve <dir> <journal> [port]   GET/PUT /v1/cache/<hash>, bearer token from
//                                  NX_SELF_HOSTED_REMOTE_CACHE_ACCESS_TOKEN
//   stage <dir> <journal> <out>    copy the entries this job wrote, and its
//                                  journal, into <out> for upload
//   prune <dir> <journal>...       delete every entry no journal names
//
// The journal is one line per entry a job used: `W <hash>` for an entry it
// wrote, `R <hash>` for one it read (or tried to write and found present).
// Pruning to the union of a run's journals is what stops a cache restored and
// saved run after run from growing without bound.

import { timingSafeEqual } from 'node:crypto';
import {
  appendFileSync,
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROUTE = /^\/v1\/cache\/([A-Za-z0-9]+)$/;

/** The hashes a set of journals names, read and written alike. */
export function journalEntries(...journals) {
  const hashes = new Set();
  for (const journal of journals) {
    if (!existsSync(journal)) continue;
    for (const line of readFileSync(journal, 'utf8').split('\n')) {
      const [, hash] = line.split(' ');
      if (hash) hashes.add(hash);
    }
  }
  return hashes;
}

function written(journal) {
  const hashes = new Set();
  if (!existsSync(journal)) return hashes;
  for (const line of readFileSync(journal, 'utf8').split('\n')) {
    const [kind, hash] = line.split(' ');
    if (kind === 'W' && hash) hashes.add(hash);
  }
  return hashes;
}

function authorized(header, token) {
  if (!token) return true;
  const expected = Buffer.from(`Bearer ${token}`);
  const actual = Buffer.from(header ?? '');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * Serve `dir` as an Nx HTTP remote cache. Resolves once listening, with the
 * bound port and a `close`.
 */
export function serve({ dir, journal, token, port = 0, host = '127.0.0.1' }) {
  mkdirSync(dir, { recursive: true });
  const record = (kind, hash) => appendFileSync(journal, `${kind} ${hash}\n`);

  const server = createServer((req, res) => {
    const match = ROUTE.exec(req.url ?? '');
    if (!match) {
      res.writeHead(404).end();
      return;
    }
    if (!authorized(req.headers.authorization, token)) {
      req.resume();
      // Nx's client insists on a text body here, and refuses the endpoint as
      // misconfigured otherwise.
      res.writeHead(401, { 'content-type': 'text/plain' }).end('Unauthorized');
      return;
    }
    const hash = match[1];
    const file = join(dir, hash);

    if (req.method === 'GET') {
      if (!existsSync(file)) {
        res.writeHead(404).end();
        return;
      }
      record('R', hash);
      res.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': statSync(file).size,
      });
      createReadStream(file).pipe(res);
      return;
    }

    if (req.method === 'PUT') {
      // An entry is immutable: its name is its content's hash.
      if (existsSync(file)) {
        req.resume();
        record('R', hash);
        res.writeHead(409).end();
        return;
      }
      // Written aside and renamed, so a reader never sees half an entry.
      const partial = `${file}.${process.pid}.partial`;
      const out = createWriteStream(partial);
      req.pipe(out);
      out.on('finish', () => {
        renameSync(partial, file);
        record('W', hash);
        res.writeHead(200).end();
      });
      out.on('error', () => {
        rmSync(partial, { force: true });
        res.writeHead(500).end();
      });
      return;
    }

    req.resume();
    res.writeHead(405).end();
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () =>
      resolve({
        port: server.address().port,
        close: () => new Promise(done => server.close(done)),
      }),
    );
  });
}

/** Copy the entries a job wrote, and its journal, into `out`. */
export function stage({ dir, journal, out }) {
  mkdirSync(out, { recursive: true });
  let count = 0;
  for (const hash of written(journal)) {
    const file = join(dir, hash);
    if (!existsSync(file)) continue;
    copyFileSync(file, join(out, hash));
    count += 1;
  }
  if (existsSync(journal)) {
    copyFileSync(journal, join(out, `journal-${basename(journal)}`));
  }
  return count;
}

/** Delete every entry in `dir` that none of `journals` names. */
export function prune({ dir, journals }) {
  const keep = journalEntries(...journals);
  let removed = 0;
  for (const name of existsSync(dir) ? readdirSync(dir) : []) {
    if (keep.has(name)) continue;
    rmSync(join(dir, name), { recursive: true, force: true });
    removed += 1;
  }
  return removed;
}

async function main([command, ...args]) {
  switch (command) {
    case 'serve': {
      const [dir, journal, port = '0'] = args;
      const { port: bound } = await serve({
        dir,
        journal,
        token: process.env.NX_SELF_HOSTED_REMOTE_CACHE_ACCESS_TOKEN,
        port: Number(port),
      });
      console.log(`nx-remote-cache listening on 127.0.0.1:${bound}`);
      return;
    }
    case 'stage': {
      const [dir, journal, out] = args;
      console.log(`staged ${stage({ dir, journal, out })} entries`);
      return;
    }
    case 'prune': {
      const [dir, ...journals] = args;
      console.log(`pruned ${prune({ dir, journals })} entries`);
      return;
    }
    default:
      console.error('usage: nx-remote-cache.mjs serve|stage|prune …');
      process.exit(2);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2));
}
