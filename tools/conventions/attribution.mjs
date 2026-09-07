/**
 * The one predicate behind the attribution convention, and the only place its
 * patterns are written.
 *
 * Plain `.mjs` with no build step, deliberately: this module is imported by
 * `commitlint.config.mjs` (which runs from `.husky/commit-msg`, long before
 * anything in `dist` exists) *and* by `conventions.spec.ts`. That is the shape
 * `tools/sync-docs.mjs` already has — a script the pipeline runs and a spec
 * imports — and it is what keeps the rule a developer's commit is judged by and
 * the rule CI asserts from ever being two different rules.
 *
 * It is pure: text in, findings out. No filesystem, no git, no process. The
 * callers own their own input, which is why the same function can judge a
 * commit message, a pull-request body and a tracked file.
 *
 * ## Why this exists as code at all
 *
 * The convention was stated in three places — `docs/DEVELOPING.md`, the
 * `create-pr` skill (four times in one file) and the maintainer's own notes —
 * and was skipped on 5 of the last 40 merged pull requests and 6 of the last 60
 * commits on `main`. Prose lost, repeatedly, to an agent instruction that arrives
 * every session claiming to replace earlier guidance. A sentence cannot win
 * that argument; a failing check can.
 */

/**
 * What counts as attribution.
 *
 * Each pattern is anchored on something structural rather than on the word
 * "Claude" alone: this repository legitimately mentions the tool in
 * `.claude/`, in skill documentation and in editor configuration, and a
 * matcher broad enough to catch those would be turned off within a week.
 *
 * `id` is what a failure reports, so it has to name the thing a person then
 * goes and deletes.
 */
export const ATTRIBUTION_PATTERNS = [
  {
    id: 'co-author-trailer',
    description:
      'a Co-authored-by trailer naming an AI assistant or its vendor',
    // Git's own canonical casing is lowercase `authored`, which is what the six
    // commits on `main` actually carry — matching only the title-cased form
    // written in the documentation would have missed every real one.
    pattern: /^[ \t]*co-authored-by:.*(claude|anthropic)/gim,
  },
  {
    id: 'session-trailer',
    description: 'a Claude-Session trailer',
    pattern: /^[ \t]*claude-session:/gim,
  },
  {
    id: 'session-link',
    description: 'a link back to an assistant session',
    pattern: /claude\.ai\/code\/session[_-]/gi,
  },
  {
    id: 'vendor-noreply',
    description: 'a vendor no-reply address used as an author identity',
    pattern: /noreply@anthropic\.com/gi,
  },
  {
    id: 'generated-with',
    description: 'a "Generated with" advertisement line',
    pattern: /generated with \[?claude/gi,
  },
];

/**
 * Files allowed to contain the patterns above, each because its job is to
 * describe them.
 *
 * Kept short and pinned by the spec. An exemption list is how a check like this
 * decays — every entry is a place the rule stops applying — so adding one has
 * to be a visible decision rather than a quiet append.
 */
export const ATTRIBUTION_EXEMPT = [
  {
    path: 'tools/conventions/',
    reason: 'defines the patterns and tests them against real examples',
  },
  {
    path: 'docs/adr/0046-conventions-are-checked-not-stated.md',
    reason: 'the record explaining what is forbidden, quoting it',
  },
];

/*
 * ⚠️ `.claude/` is **deliberately absent** from that list, although the
 * `create-pr` skill under it does contain the literal strings. The directory is
 * gitignored (`.gitignore`), the repository scan reads `git ls-files`, and an
 * untracked file can never reach it — so the exemption did nothing except
 * assert the existence of a file CI does not check out, which is exactly how it
 * failed on its first run. An exemption is only meaningful for a **tracked**
 * path.
 */

/** Whether a repository-relative path is allowed to carry attribution. */
export function isAttributionExempt(path) {
  const normalized = path.replaceAll('\\', '/');
  return ATTRIBUTION_EXEMPT.some(entry => normalized.startsWith(entry.path));
}

/**
 * Every attribution occurrence in a block of text.
 *
 * Returns findings rather than a boolean so a failure can say which line to
 * delete. `lastIndex` is reset per call because the patterns are module-level
 * and `/g`-flagged: a shared regex carries its cursor between calls, so the
 * second caller in a process would start scanning from wherever the first one
 * stopped and quietly miss a match near the top of its input.
 *
 * @param {string} text
 * @returns {{ id: string, description: string, match: string, line: number }[]}
 */
export function findAttribution(text) {
  if (typeof text !== 'string' || text === '') return [];

  const findings = [];
  for (const { id, description, pattern } of ATTRIBUTION_PATTERNS) {
    pattern.lastIndex = 0;
    for (const hit of text.matchAll(pattern)) {
      findings.push({
        id,
        description,
        match: hit[0].trim(),
        // 1-based, counted from the text the caller passed in.
        line: text.slice(0, hit.index).split('\n').length,
      });
    }
  }
  return findings.sort((a, b) => a.line - b.line || a.id.localeCompare(b.id));
}

/**
 * A findings list rendered for a human who has to act on it.
 *
 * Shared so the commit hook, the CI step and the spec all report the same way —
 * a developer who has seen the message once recognizes it in the other two
 * places.
 */
export function formatAttributionFindings(findings, subject) {
  if (findings.length === 0) return '';
  const lines = findings.map(
    finding => `  line ${finding.line}: ${finding.match}  (${finding.id})`,
  );
  return [
    `${subject} carries AI attribution, which this repository does not use:`,
    ...lines,
    '',
    'Remove those lines. See docs/adr/0046-conventions-are-checked-not-stated.md.',
  ].join('\n');
}
