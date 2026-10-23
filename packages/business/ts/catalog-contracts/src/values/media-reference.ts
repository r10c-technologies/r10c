import { accessor, EntifixBuildError } from '@entifix/core';

/**
 * One picture of a product: **a reference the vendor authored, never bytes we
 * store** ([ADR 0061](../../../../../../docs/adr/0061-the-snapshot-carries-media-and-the-vendor-is-a-projection.md)).
 *
 * The plain shape everything outside an entity speaks — the bus payload, the
 * projected document, a fixture row. {@link MediaReference} is the same two
 * members described for a detail grid.
 */
export interface MediaReferenceValue {
  /** An absolute `https:` URL. Checked at save by {@link mediaRefusal}. */
  readonly url: string;
  /**
   * The text alternative. Required on every entry: an image without one is an
   * accessibility defect, and the vendor is the only party who knows what the
   * picture shows.
   */
  readonly alt: string;
}

/**
 * One row of a `media` composition — a **value**, not an entity, so it has no
 * id and is never addressed apart from the record that holds it (ADR 0034).
 *
 * Declared here rather than in either domain because both hold it:
 * `ProductSpecification` authors it and `PublishedOffering` projects it, and a
 * `business:domain` package may not depend on another. The order of a `media`
 * array is the vendor's — the first entry is the card image — so there is no
 * `primary` flag: a flag can be set on two entries, and an order cannot.
 */
export class MediaReference implements MediaReferenceValue {
  #url: string;
  #alt: string;

  constructor(url = '', alt = '') {
    this.#url = url;
    this.#alt = alt;
  }

  @accessor({
    type: 'string',
    labelKey: 'entity:media-reference.fields.url',
    required: true,
  })
  get url(): string {
    return this.#url;
  }
  set url(value: string) {
    this.#url = value;
  }

  @accessor({
    type: 'string',
    labelKey: 'entity:media-reference.fields.alt',
    required: true,
  })
  get alt(): string {
    return this.#alt;
  }
  set alt(value: string) {
    this.#alt = value;
  }
}

/** A media entry whose URL is not an absolute `https:` URL. */
export const MEDIA_NOT_HTTPS = 'mediaNotHttps';
/** A media entry with no text alternative. */
export const MEDIA_ALT_MISSING = 'mediaAltMissing';

export type MediaRefusalCode =
  typeof MEDIA_NOT_HTTPS | typeof MEDIA_ALT_MISSING;

/**
 * `true` for an absolute `https:` URL and nothing else.
 *
 * ⚠️ Parsed, never prefix-matched. The storefront renders this into an `src`
 * on a page served over `https`, so a relative path, a protocol-less `//host`,
 * `http:` (blocked as mixed content) and `javascript:` or `data:` (a hole) all
 * have to fail, and `URL` is what tells them apart. A reader must not relax it.
 */
export const isHttpsUrl = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
};

const hasAlt = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '';

/**
 * Why a specification's media may not be saved, or `undefined` when it may.
 *
 * The **one write path** check ADR 0061 puts the security boundary at. The URL
 * is judged before the alt text, because an unsafe URL is the refusal that
 * matters and a vendor fixing both should be told about that one first.
 */
export const mediaRefusal = (
  media: readonly Partial<MediaReferenceValue>[] | undefined,
): MediaRefusalCode | undefined => {
  if (media === undefined) return undefined;
  if (media.some(entry => !isHttpsUrl(entry.url))) return MEDIA_NOT_HTTPS;
  if (media.some(entry => !hasAlt(entry.alt))) return MEDIA_ALT_MISSING;
  return undefined;
};

/**
 * A save refused by {@link mediaRefusal}. An `EntifixBuildError`, so it travels
 * through every port that admits one, and it carries the code the route answers
 * with — the i18n `errors` catalog has an entry for each.
 */
export class MediaRefusedError extends EntifixBuildError {
  readonly code: MediaRefusalCode;

  constructor(code: MediaRefusalCode) {
    super(`media refused (${code})`, undefined, { code });
    this.code = code;
  }
}

/**
 * Reads `media` off a bus payload or a stored document.
 *
 * It **never rejects** — the reason `optionalString` never does: a rejected
 * publication is poison, quarantined with zero retries, and an offering whose
 * picture is bad would become permanently unannounceable. Instead it keeps only
 * the entries {@link mediaRefusal} would have accepted, so the projection can
 * never hold a URL the save would have refused, and an empty result is
 * **absent** (`undefined`) rather than `[]` — an empty gallery is a slot that
 * claims to hold something (ADR 0049).
 */
export const readMedia = (
  value: unknown,
): readonly MediaReferenceValue[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const media = value
    .filter(
      (entry): entry is Record<string, unknown> =>
        entry !== null && typeof entry === 'object',
    )
    .filter(entry => isHttpsUrl(entry['url']) && hasAlt(entry['alt']))
    .map(entry => ({
      url: entry['url'] as string,
      alt: entry['alt'] as string,
    }));
  return media.length > 0 ? media : undefined;
};
