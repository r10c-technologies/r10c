/**
 * The group a redemption of an access link answered (`{ id }`), or `undefined`
 * for anything else — a refusal, a malformed body, no answer at all — so the
 * action never opens a receipt it was not handed (ADR 0076 §6).
 */
export const redeemedGroup = (body: unknown): string | undefined => {
  const id = (body as { id?: unknown } | null | undefined)?.id;
  return typeof id === 'string' && id !== '' ? id : undefined;
};
