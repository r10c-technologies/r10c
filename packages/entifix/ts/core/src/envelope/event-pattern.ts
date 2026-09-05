/**
 * Whether an event name is matched by a subscription pattern, using AMQP topic
 * semantics: `*` matches exactly one dot-separated word, `#` matches zero or
 * more.
 *
 * The broker does this itself in production — a subscriber binds its pattern and
 * never sees a non-matching message. This exists for the places that have no
 * broker: the in-memory bus double, and any register check that has to decide
 * whether a declared `subscriptions` entry is covered by someone's
 * `publishedEvents`. Keeping one implementation of the semantics is what stops a
 * test passing against a rule the real exchange applies differently.
 */
export function matchesEventPattern(pattern: string, name: string): boolean {
  const match = (
    patternWords: readonly string[],
    nameWords: readonly string[],
  ): boolean => {
    if (patternWords.length === 0) {
      return nameWords.length === 0;
    }
    const [head, ...rest] = patternWords;
    if (head === '#') {
      // Zero words, or one more consumed and `#` tried again.
      return (
        match(rest, nameWords) ||
        (nameWords.length > 0 && match(patternWords, nameWords.slice(1)))
      );
    }
    if (nameWords.length === 0) {
      return false;
    }
    return (
      (head === '*' || head === nameWords[0]) && match(rest, nameWords.slice(1))
    );
  };

  return match(pattern.split('.'), name.split('.'));
}
