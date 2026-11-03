/**
 * A YAML emitter for plain data — maps, sequences, strings, numbers, booleans.
 *
 * The rendered files are configuration, not documents: no anchors, no
 * multi-line scalars, no comments inside the tree. That subset is a few lines,
 * where a YAML library would be a dependency for this project alone. The result
 * is run through Prettier before it is written or compared, so the layout here
 * only has to be valid, not pretty.
 */
export type Yaml =
  | string
  | number
  | boolean
  | readonly Yaml[]
  | { readonly [key: string]: Yaml };

// A plain scalar that YAML would read back as exactly this string: no
// indicator up front, nothing that could start a comment or a mapping, and not
// a word YAML would turn into a boolean, a null or a number.
const PLAIN = /^[A-Za-z_/][A-Za-z0-9_./-]*$/;
const RESERVED = /^(true|false|yes|no|on|off|null|y|n)$/i;

const scalar = (value: string | number | boolean): string => {
  if (typeof value !== 'string') return String(value);
  return PLAIN.test(value) && !RESERVED.test(value)
    ? value
    : JSON.stringify(value);
};

const isScalar = (value: Yaml): value is string | number | boolean =>
  typeof value !== 'object';

const lines = (value: Yaml, indent: string): string[] => {
  if (isScalar(value)) return [`${indent}${scalar(value)}`];

  if (Array.isArray(value)) {
    if (value.length === 0) return [`${indent}[]`];
    return (value as readonly Yaml[]).flatMap(item => {
      if (isScalar(item)) return [`${indent}- ${scalar(item)}`];
      const [first = '', ...rest] = lines(item, `${indent}  `);
      return [`${indent}- ${first.trimStart()}`, ...rest];
    });
  }

  const entries = Object.entries(value as { readonly [key: string]: Yaml });
  if (entries.length === 0) return [`${indent}{}`];
  return entries.flatMap(([key, item]) => {
    const name = scalar(key);
    if (isScalar(item)) return [`${indent}${name}: ${scalar(item)}`];
    if (Array.isArray(item) && item.length === 0)
      return [`${indent}${name}: []`];
    if (!Array.isArray(item) && Object.keys(item).length === 0)
      return [`${indent}${name}: {}`];
    return [`${indent}${name}:`, ...lines(item, `${indent}  `)];
  });
};

/** One YAML document. */
export const toYaml = (value: Yaml): string =>
  `${lines(value, '').join('\n')}\n`;

/** Several documents in one file, `---`-separated. */
export const toYamlStream = (documents: readonly Yaml[]): string =>
  documents.map(toYaml).join('---\n');
