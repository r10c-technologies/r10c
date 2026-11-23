import {
  sampleCategory,
  sampleMediaPath,
  type SampleProduct,
  SEEDED_VENDORS,
} from '@r10c/utils-ts-fleet';

import { DRAWINGS } from './art.js';

/**
 * The apps that render a sample picture: the storefront, and the back office's
 * offering pages. Each serves its own copy from `public/`, so the picture is
 * same-origin wherever it shows (ADR 0061 as revised by #676).
 */
export const SERVING_APPS = ['apps/marketplace-app', 'apps/back-office-app'];

const INK = '#1f2328';

const escape = (text: string): string =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/** A name split into at most two lines of about 26 characters. */
const linesOf = (name: string): string[] => {
  const words = name.split(' ');
  const lines: string[] = [''];
  for (const word of words) {
    const last = lines.length - 1;
    const candidate = lines[last] === '' ? word : `${lines[last]} ${word}`;
    if (candidate.length > 26 && lines[last] !== '' && lines.length < 2) {
      lines.push(word);
    } else {
      lines[last] = candidate;
    }
  }
  return lines;
};

/**
 * One product's picture: its drawing in its category's tone on a pale ground
 * of the same tone, the product's name beneath, and a "Muestra" tag, so the
 * picture itself says it is not a photograph of stock.
 */
export const renderSamplePicture = (product: SampleProduct): string => {
  const { tone } = sampleCategory(product.category);
  const name = linesOf(product.name)
    .map(
      (line, index) =>
        `<text x="400" y="${String(690 + index * 52)}" text-anchor="middle" font-size="40" font-weight="600" fill="${INK}">${escape(line)}</text>`,
    )
    .join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" role="img" aria-label="${escape(product.name)}">` +
    `<rect width="800" height="800" fill="${tone}" opacity=".12"/>` +
    `<rect width="800" height="800" fill="none"/>` +
    `<g font-family="system-ui, -apple-system, 'Segoe UI', sans-serif">` +
    `<g transform="translate(200 160)">${DRAWINGS[product.art](tone, INK)}</g>` +
    name +
    `<rect x="32" y="32" width="150" height="48" rx="24" fill="#fff" stroke="${tone}" stroke-width="3"/>` +
    `<text x="107" y="64" text-anchor="middle" font-size="24" font-weight="600" fill="${INK}">Muestra</text>` +
    `</g></svg>\n`
  );
};

/** Every sample picture, by repository path, for every serving app. */
export const renderSampleMedia = (): Record<string, string> =>
  Object.fromEntries(
    SEEDED_VENDORS.flatMap(vendor =>
      vendor.products.flatMap(product =>
        SERVING_APPS.map(app => [
          `${app}/public${sampleMediaPath(vendor, product)}`,
          renderSamplePicture(product),
        ]),
      ),
    ),
  );
