import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { journalEntries, prune, serve, stage } from './nx-remote-cache.mjs';

let root;
let dir;
let journal;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'nx-remote-cache-'));
  dir = join(root, 'entries');
  journal = join(root, 'journal');
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('serve', () => {
  const token = 'secret';
  let server;
  let url;
  const auth = { authorization: `Bearer ${token}` };

  beforeEach(async () => {
    server = await serve({ dir, journal, token });
    url = hash => `http://127.0.0.1:${server.port}/v1/cache/${hash}`;
  });

  afterEach(() => server.close());

  it('answers 404 for an entry it does not hold, and journals nothing', async () => {
    const res = await fetch(url('111'), { headers: auth });
    assert.equal(res.status, 404);
    assert.equal(existsSync(journal), false);
  });

  it('stores a PUT and serves it back byte for byte', async () => {
    const body = Buffer.from('tarball bytes');
    const put = await fetch(url('222'), { method: 'PUT', headers: auth, body });
    assert.equal(put.status, 200);

    const get = await fetch(url('222'), { headers: auth });
    assert.equal(get.status, 200);
    assert.deepEqual(Buffer.from(await get.arrayBuffer()), body);
    assert.equal(readFileSync(journal, 'utf8'), 'W 222\nR 222\n');
  });

  it('refuses to overwrite an entry, and journals it as used', async () => {
    await fetch(url('333'), { method: 'PUT', headers: auth, body: 'first' });
    const again = await fetch(url('333'), {
      method: 'PUT',
      headers: auth,
      body: 'second',
    });
    assert.equal(again.status, 409);
    assert.equal(readFileSync(join(dir, '333'), 'utf8'), 'first');
    assert.equal(readFileSync(journal, 'utf8'), 'W 333\nR 333\n');
  });

  it('refuses a request without the token', async () => {
    const res = await fetch(url('444'), { method: 'PUT', body: 'x' });
    assert.equal(res.status, 401);
    // Nx refuses the endpoint as misconfigured on any other 401 body.
    assert.equal(res.headers.get('content-type'), 'text/plain');
    assert.equal(existsSync(join(dir, '444')), false);
  });

  it('refuses a request with the wrong token', async () => {
    const res = await fetch(url('444'), {
      headers: { authorization: 'Bearer nope' },
    });
    assert.equal(res.status, 401);
  });

  it('answers 404 for a path that is not an entry, so nothing escapes the directory', async () => {
    const res = await fetch(
      `http://127.0.0.1:${server.port}/v1/cache/..%2Fjournal`,
      { headers: auth },
    );
    assert.equal(res.status, 404);
  });

  it('answers 405 for any other method', async () => {
    const res = await fetch(url('555'), { method: 'DELETE', headers: auth });
    assert.equal(res.status, 405);
  });
});

describe('stage', () => {
  it('copies only the entries this job wrote, and its journal', () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'written'), 'w');
    writeFileSync(join(dir, 'restored'), 'r');
    writeFileSync(journal, 'W written\nR restored\n');

    const out = join(root, 'out');
    assert.equal(stage({ dir, journal, out }), 1);
    assert.deepEqual(readdirSync(out).sort(), ['journal-journal', 'written']);
  });

  it('stages nothing, and no journal, when the job never reached the cache', () => {
    const out = join(root, 'out');
    assert.equal(stage({ dir, journal, out }), 0);
    assert.deepEqual(readdirSync(out), []);
  });
});

describe('prune', () => {
  it('keeps every entry any journal names and deletes the rest', () => {
    mkdirSync(dir, { recursive: true });
    for (const name of ['a', 'b', 'c', 'stale']) {
      writeFileSync(join(dir, name), name);
    }
    const first = join(root, 'journal-1');
    const second = join(root, 'journal-2');
    writeFileSync(first, 'W a\nR b\n');
    writeFileSync(second, 'R c\n');

    assert.equal(prune({ dir, journals: [first, second] }), 1);
    assert.deepEqual(readdirSync(dir).sort(), ['a', 'b', 'c']);
  });

  it('reads a missing journal as naming nothing', () => {
    assert.deepEqual([...journalEntries(join(root, 'absent'))], []);
  });
});
