import { EntifixLogicError } from '../base-entities/entifix-error';
import type { CommandOption } from './command-source';

/**
 * Normalize a string for matching: case-folded, and with accents removed.
 *
 * ⚠️ The accent fold is correctness, not polish. The fleet ships Spanish as its
 * default locale, and without it `categoria` does not match `Categoría`, `marron`
 * does not match `Marrón`, and `articulo` does not match `Artículo` — so the
 * palette silently finds nothing for the most natural way to type most of its
 * own copy. Nobody reaches for the accented key in a search box.
 *
 * NFD splits a precomposed letter into its base plus a combining mark, and the
 * `\p{Diacritic}` class is what then removes only the mark. `ñ` decomposes too,
 * so `nino` matches `Niño` — which is what a person typing quickly wants, even
 * though ñ is a letter of its own in Spanish rather than an accented n.
 */
export function foldForMatch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase();
}

/**
 * Does `text` contain every character of `term`, in order?
 *
 * Subsequence rather than substring, so `prbr` finds "Producto Bruto" and `numa`
 * finds "Nueva marca" — the thing that makes a palette feel fast. Deliberately
 * **not** scored: ADR 0040 fixed group order as the ranking, and a score inside
 * a group would reshuffle it on every keystroke for no gain a person can learn.
 *
 * An empty term matches everything, which is what makes an unfiltered palette
 * the same code path as a filtered one.
 */
export function subsequenceMatch(term: string, text: string): boolean {
  const needle = foldForMatch(term);
  if (needle === '') return true;

  const haystack = foldForMatch(text);
  let cursor = 0;
  for (const character of haystack) {
    if (character === needle[cursor]) cursor += 1;
    if (cursor === needle.length) return true;
  }
  return false;
}

/**
 * Does this option answer to `term`, by its label or by any of its keywords?
 *
 * The keywords are what let a Spanish command match an English word someone
 * typed — "Nuevo producto" answering to `new` — without translating the label.
 */
export function matchesCommand(term: string, option: CommandOption): boolean {
  if (subsequenceMatch(term, option.label)) return true;
  return (option.keywords ?? []).some(keyword =>
    subsequenceMatch(term, keyword),
  );
}

/**
 * Split a catalog-resolved keyword list into terms.
 *
 * `MetaUseCase.keywordsKey` is a catalog **key** rather than a `string[]` so the
 * terms are per-locale; what the catalog holds is therefore one string, and this
 * is the convention for reading it. Commas, because a keyword may itself be two
 * words ("cerrar sesión") and splitting on whitespace would break that into
 * terms that match nothing on their own.
 *
 * Empty entries are dropped rather than kept as `''`, which would match every
 * option through {@link subsequenceMatch}'s empty-term rule.
 */
export function parseKeywords(value: string | undefined): string[] {
  if (value === undefined) return [];
  return value
    .split(',')
    .map(keyword => keyword.trim())
    .filter(keyword => keyword !== '');
}

/** Which sources a typed term is asking for. */
export type CommandScope = 'all' | 'commands' | 'records';

/** A term, split into the scope its prefix asked for and the rest. */
export interface ParsedCommandTerm {
  readonly scope: CommandScope;
  readonly term: string;
}

/**
 * `>` narrows to commands, `#` to records, anything else searches both.
 *
 * A grammar for *entry* rather than for depth: descending into a sub-picker is a
 * page stack, not a third prefix, because a prefix a person has to remember is
 * worse than a list they can see. Two characters only, and both are the ones
 * VS Code and GitHub already trained people on.
 *
 * The prefix is stripped and the remainder trimmed at the front only — a
 * trailing space is something the person is still typing, and eating it would
 * make the list jump between keystrokes.
 */
export function parseCommandTerm(raw: string): ParsedCommandTerm {
  if (raw.startsWith('>')) {
    return { scope: 'commands', term: raw.slice(1).trimStart() };
  }
  if (raw.startsWith('#')) {
    return { scope: 'records', term: raw.slice(1).trimStart() };
  }
  return { scope: 'all', term: raw };
}

/**
 * The one thing selecting an option does.
 *
 * An option declaring none is a line that looks selectable and does nothing;
 * one declaring two is a line whose behaviour depends on the order a renderer
 * happens to check its members in. Both are silent, so this throws — at the
 * first render of the palette rather than on the click, which is the posture
 * `surfaceFor` and `assertSearchable` already take for the same reason.
 */
export function commandEffectOf(
  option: CommandOption,
): 'href' | 'run' | 'push' {
  const declared = (['href', 'run', 'push'] as const).filter(
    effect => option[effect] !== undefined,
  );

  if (declared.length !== 1) {
    throw new EntifixLogicError(
      `The command "${option.id}" declares ${declared.length} effects (${declared.join(', ') || 'none'}), and must declare exactly one. ` +
        'Give it an `href` to navigate, a `run` to invoke, or a `push` to open another page.',
      undefined,
      { id: option.id, declared },
    );
  }

  return declared[0];
}
