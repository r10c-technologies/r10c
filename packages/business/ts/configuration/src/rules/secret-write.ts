/** What a save may do to a row, given what is stored and what arrived. */
export type SecretWriteDecision =
  | { readonly _tag: 'refuse'; readonly code: 'secretRequiresValue' }
  | { readonly _tag: 'accept'; readonly value: string | undefined };

const hasValue = (value: string | undefined): value is string =>
  value !== undefined && value !== '';

/**
 * The write-only rule for a credential, decided once.
 *
 * - **An absent or empty value on a row that is already secret keeps the stored
 *   value**, so a form that renders the field blank does not wipe a credential
 *   on save.
 * - **Clearing `isSecret` needs a new value.** Otherwise flipping the flag off
 *   would make the next read return the plaintext — turning a configuration
 *   *write* grant into a read of every credential in the fleet, which is exactly
 *   the escalation the write-only rule exists to prevent.
 */
export const decideSecretWrite = (
  stored: { readonly isSecret: boolean; readonly value: string } | undefined,
  incoming: { readonly isSecret?: boolean; readonly value?: string },
): SecretWriteDecision => {
  const wasSecret = stored?.isSecret ?? false;
  if (wasSecret && incoming.isSecret === false && !hasValue(incoming.value)) {
    return { _tag: 'refuse', code: 'secretRequiresValue' };
  }
  return {
    _tag: 'accept',
    value:
      wasSecret && !hasValue(incoming.value) ? stored?.value : incoming.value,
  };
};
