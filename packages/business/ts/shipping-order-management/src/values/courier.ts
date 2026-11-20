import { Schema } from 'effect';

/**
 * One courier, as a configuration row describes it: a key, the name a person
 * reads and the URL a parcel is followed at, with one `{guide}` placeholder —
 * public facts only, and no real courier is seeded (ADR 0081 §10). An empty
 * template is a courier with no tracking page: `other`.
 */
export interface Courier {
  readonly key: string;
  readonly name: string;
  readonly trackingUrlTemplate: string;
}

/** The dictionary key a seller picks when their courier is not listed. */
export const OTHER_COURIER = 'other';

/** The placeholder a tracking template carries, exactly once. */
export const GUIDE_PLACEHOLDER = '{guide}';

/** The longest tracking number a shipment keeps. */
export const TRACKING_NUMBER_MAX_LENGTH = 64;

/** The longest courier name a seller may type for `other`. */
const COURIER_NAME_MAX_LENGTH = 80;

/** The longest tracking URL a seller may paste for `other`. */
const TRACKING_URL_MAX_LENGTH = 2048;

/** What `record-guide` carries. */
export const GuidePayload = Schema.Struct({
  courierKey: Schema.String,
  trackingNumber: Schema.String,
  /** A name the seller types when the courier is `other`. */
  courierName: Schema.optionalKey(Schema.String),
  /** A tracking page the seller pastes when the courier is `other`. */
  trackingUrl: Schema.optionalKey(Schema.String),
});
export type GuidePayload = typeof GuidePayload.Type;

/**
 * A recorded guide, with its courier copied as it was at the guide: a
 * dictionary edit changes no shipment already on its way (ADR 0081 §10). An
 * empty `trackingUrl` is a parcel with no page to follow it at.
 */
export interface Guide {
  readonly courierKey: string;
  readonly courierName: string;
  readonly trackingNumber: string;
  readonly trackingUrl: string;
}

export type CheckedGuide =
  | { readonly ok: true; readonly value: Guide }
  | { readonly ok: false; readonly field: string; readonly reason: string };

const refused = (field: string, reason: string) =>
  ({ ok: false, field, reason }) as const;

/** The URL when it parses as `https`, otherwise `undefined`. */
const httpsUrl = (url: string): URL | undefined => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? parsed : undefined;
  } catch {
    return undefined;
  }
};

/** Whether a template is an `https` URL with exactly one `{guide}`. */
const isTemplate = (template: string): boolean =>
  template.split(GUIDE_PLACEHOLDER).length === 2 &&
  httpsUrl(template.replace(GUIDE_PLACEHOLDER, 'x')) !== undefined;

/**
 * Check a guide against the courier dictionary: a tracking number of 1 to 64
 * characters, a courier somebody configured, and the tracking URL rendered from
 * its template with the number encoded into it. `other` takes the seller's own
 * name for it and, if they have one, their own `https` tracking page.
 */
export const guideOf = (
  payload: GuidePayload,
  couriers: readonly Courier[],
): CheckedGuide => {
  const trackingNumber = payload.trackingNumber.trim();
  if (
    trackingNumber === '' ||
    trackingNumber.length > TRACKING_NUMBER_MAX_LENGTH
  ) {
    return refused(
      'trackingNumber',
      `a tracking number has 1 to ${String(TRACKING_NUMBER_MAX_LENGTH)} characters`,
    );
  }
  const courier = couriers.find(entry => entry.key === payload.courierKey);
  if (courier === undefined) {
    return refused('courierKey', 'the courier is not one this market lists');
  }
  if (courier.key !== OTHER_COURIER) {
    return {
      ok: true,
      value: {
        courierKey: courier.key,
        courierName: courier.name,
        trackingNumber,
        trackingUrl:
          courier.trackingUrlTemplate === ''
            ? ''
            : courier.trackingUrlTemplate.replace(
                GUIDE_PLACEHOLDER,
                encodeURIComponent(trackingNumber),
              ),
      },
    };
  }
  const typedUrl = payload.trackingUrl?.trim() ?? '';
  const pasted = typedUrl === '' ? undefined : httpsUrl(typedUrl);
  if (
    typedUrl !== '' &&
    (pasted === undefined || typedUrl.length > TRACKING_URL_MAX_LENGTH)
  ) {
    return refused('trackingUrl', 'a tracking page is an https address');
  }
  const typedName = payload.courierName?.trim() ?? '';
  return {
    ok: true,
    value: {
      courierKey: courier.key,
      courierName:
        typedName === ''
          ? courier.name
          : typedName.slice(0, COURIER_NAME_MAX_LENGTH),
      trackingNumber,
      trackingUrl: pasted === undefined ? '' : pasted.toString(),
    },
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/**
 * One configuration row's value, read as a courier — or `undefined` when it is
 * not one, so a mistyped row drops out rather than rendering a broken link.
 */
export const courierOf = (key: string, value: unknown): Courier | undefined => {
  let row: unknown = value;
  if (typeof value === 'string') {
    try {
      row = JSON.parse(value) as unknown;
    } catch {
      return undefined;
    }
  }
  if (!isRecord(row)) return undefined;
  const { name, trackingUrlTemplate } = row;
  if (typeof name !== 'string' || name.trim() === '') return undefined;
  if (typeof trackingUrlTemplate !== 'string') return undefined;
  if (trackingUrlTemplate !== '' && !isTemplate(trackingUrlTemplate)) {
    return undefined;
  }
  return { key, name: name.trim(), trackingUrlTemplate };
};
