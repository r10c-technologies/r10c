/**
 * A line's total is computed once, by `lineTotal`, and every figure after it
 * — an order's total, a capture, a commission, a tax base, a receipt — sums
 * what it computed (ADR 0082 §6). A quantity is a scaled integer: `3500` in
 * the metre's scale is 3.5 m, and `amount * quantity` on it charges a
 * thousand times over. It also skips `pricePer` and the half-up rounding the
 * FEL document is certified on.
 *
 * So no source file may multiply anything that names a quantity, except the
 * one function that knows the scale. The check reads the TypeScript syntax
 * tree rather than the text, because the forms that escaped a grep before were
 * `Number(line['quantity']) * …` and a quantity destructured under another
 * name.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** The one place a quantity is multiplied: it knows the unit's scale. */
const ALLOWED = new Set([
  'packages/business/ts/sales-vocabulary/src/values/line-total.ts',
]);

const NAMES_QUANTITY = /quantit/i;

const isSource = (file: string) =>
  /\.tsx?$/.test(file) &&
  !/\.d\.ts$/.test(file) &&
  !/\.(spec|test|stories)\.tsx?$/.test(file);

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return ['node_modules', 'dist', 'out-tsc', '.next', 'testing'].includes(
        entry.name,
      )
        ? []
        : walk(path);
    }
    return isSource(path) ? [path] : [];
  });

/** Every `src` directory under `root`, at any depth, outside e2e apps. */
const sourceRoots = (root: string): string[] =>
  readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    if (!entry.isDirectory() || entry.name === 'node_modules') return [];
    if (entry.name.endsWith('-e2e')) return [];
    const path = join(root, entry.name);
    return entry.name === 'src' ? [path] : sourceRoots(path);
  });

/**
 * The names a file binds a quantity to under another name — `{ quantity: q }`
 * — so `amount * q` is read as the quantity it is.
 */
const aliasesOf = (source: ts.SourceFile): ReadonlySet<string> => {
  const aliases = new Set<string>();
  const visit = (node: ts.Node) => {
    if (
      ts.isBindingElement(node) &&
      node.propertyName !== undefined &&
      NAMES_QUANTITY.test(node.propertyName.getText(source)) &&
      ts.isIdentifier(node.name)
    ) {
      aliases.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return aliases;
};

/** Whether an operand reads a quantity: a name, a property or a key naming one. */
const readsQuantity = (
  operand: ts.Node,
  aliases: ReadonlySet<string>,
): boolean => {
  if (ts.isIdentifier(operand)) {
    return NAMES_QUANTITY.test(operand.text) || aliases.has(operand.text);
  }
  if (ts.isStringLiteralLike(operand)) return NAMES_QUANTITY.test(operand.text);
  if (ts.isFunctionLike(operand)) return false;
  let found = false;
  ts.forEachChild(operand, child => {
    found ||= readsQuantity(child, aliases);
  });
  return found;
};

const MULTIPLY = new Set([
  ts.SyntaxKind.AsteriskToken,
  ts.SyntaxKind.AsteriskEqualsToken,
]);

/** Where a file multiplies a quantity, as `path:line` with the expression. */
export const quantityMultiplications = (
  path: string,
  text: string,
): readonly string[] => {
  const source = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const aliases = aliasesOf(source);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isBinaryExpression(node) &&
      MULTIPLY.has(node.operatorToken.kind) &&
      (readsQuantity(node.left, aliases) || readsQuantity(node.right, aliases))
    ) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart());
      found.push(`${path}:${String(line + 1)} ${node.getText(source)}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
};

const FILES = [
  ...sourceRoots(join(REPO_ROOT, 'packages')),
  ...sourceRoots(join(REPO_ROOT, 'apps')),
].flatMap(walk);

describe('a quantity is multiplied only by lineTotal (ADR 0082 §6)', () => {
  it('scans the source of every package and service', () => {
    // Pinned from below so a scan that stops finding files fails instead of
    // passing on nothing.
    expect(FILES.length).toBeGreaterThan(900);
    expect(FILES.map(file => relative(REPO_ROOT, file))).toContain(
      [...ALLOWED][0],
    );
  });

  it('finds the multiplication lineTotal makes, and none anywhere else', () => {
    const hits = FILES.flatMap(file => {
      const path = relative(REPO_ROOT, file);
      return quantityMultiplications(path, readFileSync(file, 'utf8'));
    });

    expect(
      hits.filter(hit => ALLOWED.has(hit.split(':')[0] ?? '')),
    ).not.toEqual([]);
    expect(hits.filter(hit => !ALLOWED.has(hit.split(':')[0] ?? ''))).toEqual(
      [],
    );
  });

  it('fails a plain multiplication of a price by a quantity', () => {
    expect(
      quantityMultiplications('x.ts', 'const t = line.amount * line.quantity;'),
    ).toEqual(['x.ts:1 line.amount * line.quantity']);
    expect(
      quantityMultiplications('x.ts', 'let t = 5; t *= quantity;'),
    ).toHaveLength(1);
  });

  it('fails one read through a key and a conversion', () => {
    expect(
      quantityMultiplications(
        'x.ts',
        "const t = Number(line['amount']) * Number(line['quantity']);",
      ),
    ).toHaveLength(1);
  });

  it('fails one destructured, under its own name or another', () => {
    expect(
      quantityMultiplications(
        'x.ts',
        'const { amount, quantity } = line;\nconst t = amount * quantity;',
      ),
    ).toEqual(['x.ts:2 amount * quantity']);
    expect(
      quantityMultiplications(
        'x.ts',
        'const { amount, quantity: q } = line;\nconst t = amount * q;',
      ),
    ).toEqual(['x.ts:2 amount * q']);
  });

  it('lets a multiplication that reads no quantity pass', () => {
    expect(
      quantityMultiplications(
        'x.tsx',
        'const ms = seconds * 1000; const f = () => quantity; const x = 2 * f.length;',
      ),
    ).toEqual([]);
  });
});
