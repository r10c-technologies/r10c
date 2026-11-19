import { Schema } from 'effect';

/**
 * One payment-link provider, as a configuration row describes it: a key, the
 * name a person reads and the hosts its links are served from — public facts
 * only, and no real provider is seeded (ADR 0081 §10). An empty `hosts` is a
 * provider whose links may come from anywhere: `other`.
 */
export interface PaymentLinkProvider {
  readonly key: string;
  readonly name: string;
  readonly hosts: readonly string[];
}

/** The dictionary key a seller picks when their provider is not listed. */
export const OTHER_PROVIDER = 'other';

/** The longest link an order keeps (ADR 0081 §10). */
export const PAYMENT_LINK_MAX_LENGTH = 2048;

/** The longest authorization number a confirmation keeps. */
export const PAYMENT_REFERENCE_MAX_LENGTH = 64;

/** The longest provider name a seller may type for `other`. */
const PROVIDER_NAME_MAX_LENGTH = 80;

/** What `set-payment-link` carries. */
export const PaymentLinkPayload = Schema.Struct({
  url: Schema.String,
  providerKey: Schema.String,
  /** A name the seller types when the provider is `other`. */
  providerName: Schema.optionalKey(Schema.String),
});
export type PaymentLinkPayload = typeof PaymentLinkPayload.Type;

/** What `confirm-payment` carries: the acquirer's authorization number. */
export const PaymentConfirmationPayload = Schema.Struct({
  reference: Schema.String,
});
export type PaymentConfirmationPayload = typeof PaymentConfirmationPayload.Type;

/** A link the order may carry, with its provider copied as it was set. */
export interface PaymentLink {
  readonly url: string;
  readonly providerKey: string;
  readonly providerName: string;
}

export type Checked<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly field: string; readonly reason: string };

const refused = (field: string, reason: string) =>
  ({ ok: false, field, reason }) as const;

/** The URL, parsed, or `undefined` when it does not parse. */
const parsed = (url: string) => {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
};

/**
 * Check a link against the provider dictionary: `https` only, at most 2,048
 * characters, a provider somebody configured, and — when that provider names
 * its hosts — served from one of them. `other` takes the seller's own name for
 * it, or none (ADR 0081 §10).
 */
export const paymentLinkOf = (
  payload: PaymentLinkPayload,
  providers: readonly PaymentLinkProvider[],
): Checked<PaymentLink> => {
  const url = payload.url.trim();
  if (url.length === 0 || url.length > PAYMENT_LINK_MAX_LENGTH) {
    return refused(
      'url',
      `a payment link has 1 to ${String(PAYMENT_LINK_MAX_LENGTH)} characters`,
    );
  }
  const link = parsed(url);
  if (link?.protocol !== 'https:') {
    return refused('url', 'a payment link is an https address');
  }
  const provider = providers.find(entry => entry.key === payload.providerKey);
  if (provider === undefined) {
    return refused('providerKey', 'the provider is not one this market lists');
  }
  if (
    provider.hosts.length > 0 &&
    !provider.hosts.includes(link.hostname.toLowerCase())
  ) {
    return refused(
      'url',
      `${provider.name} links are not served from ${link.hostname}`,
    );
  }
  const typed = payload.providerName?.trim() ?? '';
  const providerName =
    provider.key === OTHER_PROVIDER && typed !== ''
      ? typed.slice(0, PROVIDER_NAME_MAX_LENGTH)
      : provider.name;
  return {
    ok: true,
    value: { url: link.toString(), providerKey: provider.key, providerName },
  };
};

/** Check an authorization number: something in it, and not a paragraph. */
export const paymentReferenceOf = (
  payload: PaymentConfirmationPayload,
): Checked<string> => {
  const reference = payload.reference.trim();
  return reference === '' || reference.length > PAYMENT_REFERENCE_MAX_LENGTH
    ? refused(
        'reference',
        `an authorization number has 1 to ${String(PAYMENT_REFERENCE_MAX_LENGTH)} characters`,
      )
    : { ok: true, value: reference };
};

/**
 * One configuration row's value, read as a provider — or `undefined` when it
 * is not one, so a mistyped row drops out rather than admitting any host.
 */
export const paymentLinkProviderOf = (
  key: string,
  value: unknown,
): PaymentLinkProvider | undefined => {
  let row: unknown = value;
  if (typeof value === 'string') {
    try {
      row = JSON.parse(value) as unknown;
    } catch {
      return undefined;
    }
  }
  if (typeof row !== 'object' || row === null) return undefined;
  const { name, hosts } = row as { name?: unknown; hosts?: unknown };
  if (typeof name !== 'string' || name.trim() === '') return undefined;
  if (
    hosts !== undefined &&
    (!Array.isArray(hosts) || hosts.some(host => typeof host !== 'string'))
  ) {
    return undefined;
  }
  return {
    key,
    name: name.trim(),
    hosts: ((hosts as string[] | undefined) ?? []).map(host =>
      host.toLowerCase(),
    ),
  };
};
