import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { HARDWARE_STORE } from '@r10c/utils-ts-fleet';
import { describe, expect, it } from 'vitest';

import {
  renderSampleMedia,
  renderSamplePicture,
  SERVING_APPS,
} from './render.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');

describe('the sample pictures', () => {
  const files = renderSampleMedia();

  it('are committed exactly as the generator draws them', () => {
    // A product added without running the generator, or a picture edited by
    // hand, fails here rather than as a broken image in the lab.
    for (const [path, text] of Object.entries(files)) {
      expect(readFileSync(join(REPO_ROOT, path), 'utf8'), path).toBe(text);
    }
  });

  it('leave no picture behind for a product that is gone', () => {
    for (const app of SERVING_APPS) {
      const root = join(REPO_ROOT, app, 'public/samples');
      const onDisk = readdirSync(root, { recursive: true, withFileTypes: true })
        .filter(entry => entry.isFile())
        .map(entry =>
          join(entry.parentPath, entry.name).slice(REPO_ROOT.length + 1),
        );
      expect(onDisk.sort()).toEqual(
        Object.keys(files)
          .filter(path => path.startsWith(`${app}/`))
          .sort(),
      );
    }
  });

  it('name the product, escaped, and say they are a sample', () => {
    const svg = renderSamplePicture({
      ...HARDWARE_STORE.products[0],
      name: 'Tornillo #8 × 1½" <largo> & fino',
    });
    expect(svg).toContain('Muestra');
    expect(svg).toContain('&quot;');
    expect(svg).toContain('&lt;largo&gt; &amp; fino');
    expect(svg).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
  });
});
