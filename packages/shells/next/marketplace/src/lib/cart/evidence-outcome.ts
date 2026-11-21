/**
 * What the receipt page is told a receipt upload did, as a search param
 * (ADR 0081 §6). Each refusal is a code of the `errors` catalog, so the page
 * shows the service's own words for it; `failed` is anything else.
 */
export const EvidenceOutcomes = [
  'attached',
  'evidenceTypeRefused',
  'evidenceTooLarge',
  'evidenceLimitReached',
  'orderNotAwaitingPayment',
  'failed',
] as const;

export type EvidenceOutcome = (typeof EvidenceOutcomes)[number];

/**
 * Narrow a query param to an outcome. The value decides a translation key, so
 * an arbitrary query param must not be able to name one.
 */
export const isEvidenceOutcome = (value: unknown): value is EvidenceOutcome =>
  (EvidenceOutcomes as readonly unknown[]).includes(value);

/** Codes that are a refusal of the file itself, kept as their own outcome. */
const REFUSALS: ReadonlySet<string> = new Set(
  EvidenceOutcomes.filter(
    outcome => outcome !== 'attached' && outcome !== 'failed',
  ),
);

/**
 * Read order-service's answer to an upload. A body too large for the wire, or
 * of a type the route does not take, is the same refusal to a buyer as the
 * service's own check on the bytes.
 */
export const evidenceOutcomeOf = (
  status: number | undefined,
  body: unknown,
): EvidenceOutcome => {
  if (status !== undefined && status >= 200 && status < 300) return 'attached';
  const code = (body as { code?: unknown } | undefined)?.code;
  if (code === 'payloadTooLarge') return 'evidenceTooLarge';
  if (code === 'unsupportedMediaType') return 'evidenceTypeRefused';
  return typeof code === 'string' && REFUSALS.has(code)
    ? (code as EvidenceOutcome)
    : 'failed';
};

/** The five media types a browser may declare for a receipt it uploads. */
const DECLARED = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

/**
 * The type to declare to order-service for a file a browser sent. The service
 * sniffs the bytes regardless; this only has to be one of the types its route
 * takes, and a browser that named none (or `image/jpg`) is not refused for it.
 */
export const declaredTypeOf = (type: string): string =>
  DECLARED.has(type) ? type : 'application/pdf';
