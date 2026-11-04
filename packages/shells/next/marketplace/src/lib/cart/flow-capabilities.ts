/**
 * The flow capabilities this tab holds, which the push channel presents on
 * every (re)open so the stream admits an anonymous buyer to their own flow
 * (ADR 0072). In memory only, and only for as long as the page that waits on
 * the flow keeps it: a capability is never written anywhere a script reads
 * across pages.
 */
const held = new Set<string>();

/** Hold a capability while a page waits on its flow; the returned function lets it go. */
export const holdCapability = (capability: string): (() => void) => {
  held.add(capability);
  return () => {
    held.delete(capability);
  };
};

/** Every capability held now — `Array.from`, never a spread of the set. */
export const heldCapabilities = (): readonly string[] => Array.from(held);
