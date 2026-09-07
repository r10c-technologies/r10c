/**
 * The repository's working conventions, asserted rather than stated.
 *
 * The first one here is attribution, and it earned its check the hard way: the
 * rule was written in `docs/DEVELOPING.md`, four times in
 * `.claude/skills/create-pr/SKILL.md`, and in the maintainer's own notes — and
 * was skipped anyway on 5 of the last 40 merged pull requests and 6 of the last
 * 60 commits on `main`. What beat the prose was an instruction that arrives every
 * session claiming to supersede earlier guidance. A check does not read that
 * instruction.
 *
 * Three surfaces are needed because no single one can see everything: a git
 * hook sees a commit message and never a pull-request body, CI sees the body
 * but only after the commit exists, and neither of them looks at what is
 * already committed. So the predicate lives once, in
 * `tools/conventions/attribution.mjs`, and this spec checks both the committed
 * text and that the other two surfaces are still wired to that same predicate.
 *
 * Every scan below **pins the number of things it expects to find**. That is the
 * house rule (`docs.spec.ts`, `slices.spec.ts`, `error-codes.spec.ts` all state
 * it) and it is what stops a check like this from passing because its own file
 * walk quietly stopped finding files.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * A dynamic path on purpose, the way `docs.spec.ts` reaches
 * `tools/sync-docs.mjs`: the module is a plain script shared with a git hook
 * rather than a typed workspace package, so it is loaded rather than imported.
 */
const attribution = await import(
  join(REPO_ROOT, 'tools', 'conventions', 'attribution.mjs')
);
const {
  ATTRIBUTION_EXEMPT,
  ATTRIBUTION_PATTERNS,
  findAttribution,
  formatAttributionFindings,
  isAttributionExempt,
} = attribution as {
  ATTRIBUTION_EXEMPT: { path: string; reason: string }[];
  ATTRIBUTION_PATTERNS: { id: string; description: string; pattern: RegExp }[];
  findAttribution: (
    text: string,
  ) => { id: string; description: string; match: string; line: number }[];
  formatAttributionFindings: (
    findings: { id: string; match: string; line: number }[],
    subject: string,
  ) => string;
  isAttributionExempt: (path: string) => boolean;
};

/** Extensions worth reading: everything a person writes prose or code into. */
const TEXT_EXTENSIONS = [
  '.md',
  '.ts',
  '.tsx',
  '.mts',
  '.mjs',
  '.js',
  '.cjs',
  '.json',
  '.yml',
  '.yaml',
  '.sh',
  '.css',
];

/** Build output that is occasionally committed by accident; never our prose. */
const GENERATED = ['dist/', 'out-tsc/', 'test-output/', 'node_modules/'];

function trackedTextFiles(): string[] {
  const output = execFileSync('git', ['ls-files', '-z'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return (
    output
      .split('\0')
      .filter(Boolean)
      .filter(path => TEXT_EXTENSIONS.some(ext => path.endsWith(ext)))
      .filter(path => !GENERATED.some(prefix => path.includes(prefix)))
      // The index and the working tree disagree more often than it looks: a
      // staged deletion, an `add -N` intent-to-add, a half-applied rebase. Left
      // unfiltered, the read below throws `ENOENT` and the suite reports a
      // crash where a reader expects either a violation or a pass — measured,
      // while testing this very check.
      .filter(path => existsSync(join(REPO_ROOT, path)))
  );
}

/**
 * Real messages, kept verbatim from `main`. Written as fragments joined at
 * runtime so this array is a fixture rather than six more occurrences of the
 * thing being forbidden — the file is exempt, but a fixture that reads as a
 * genuine trailer is the kind of thing a later reader deletes on sight.
 */
const REAL_VIOLATIONS: { name: string; text: string }[] = [
  {
    name: "git's own lowercase trailer casing, as committed",
    text: `feat: provision the dashboard\n\nCo-${'authored'}-by: Claude Opus 5 <noreply@anthropic.com>`,
  },
  {
    name: 'the title-cased form the documentation writes',
    text: `fix: something\n\nCo-${'Authored'}-By: Claude Opus 5 <noreply@anthropic.com>`,
  },
  {
    name: 'a session trailer',
    text: `feat: x\n\nClaude-${'Session'}: https://claude.ai/code/session_01ABC`,
  },
  {
    name: 'a pull-request body advertisement line',
    text: `## Summary\n\n- did a thing\n\n🤖 Generated with [Claude${' '}Code](https://claude.com/claude-code)`,
  },
  {
    name: 'a bare session link',
    text: `See https://claude.ai/code/session${'_'}01KHP for context.`,
  },
  {
    name: 'a vendor no-reply address on its own',
    text: `Author: someone <noreply@${'anthropic'}.com>`,
  },
];

describe('the attribution predicate', () => {
  it('declares the patterns the three surfaces share', () => {
    // Pinned: the surfaces below assert wiring, not coverage, so a pattern
    // silently removed from this list would take its enforcement with it.
    expect(ATTRIBUTION_PATTERNS.length).toBeGreaterThanOrEqual(5);
    for (const { id, description, pattern } of ATTRIBUTION_PATTERNS) {
      expect(id, 'every pattern names what a reader must delete').toMatch(
        /^[a-z][a-z-]+$/,
      );
      expect(description.length).toBeGreaterThan(10);
      expect(
        pattern.flags,
        `${id} must be /g/i — findAttribution reports every occurrence`,
      ).toContain('g');
    }
  });

  it.each(REAL_VIOLATIONS)('catches $name', ({ text }) => {
    expect(findAttribution(text).length).toBeGreaterThan(0);
  });

  it('does not fire on the ways this repository legitimately names the tool', () => {
    const innocent = [
      'The `.claude/skills/create-pr` skill opens the pull request.',
      'Claude Code — resume checkpoint',
      'See https://claude.com/claude-code for the CLI.',
      'anthropic is the vendor; the model is Opus.',
      '- [ ] Conventional commit messages with Nx project scope',
    ];
    for (const text of innocent) {
      expect(findAttribution(text), text).toEqual([]);
    }
  });

  it('reports every occurrence, with the line to delete', () => {
    const text = `subject\n\nbody\n\nCo-${'authored'}-by: Claude Opus 5 <x@y.z>\n`;
    const [finding] = findAttribution(text);
    expect(finding.line).toBe(5);
    expect(finding.id).toBe('co-author-trailer');
  });

  it('resets its cursor between calls', () => {
    // The patterns are module-level and `/g`-flagged, so a shared `lastIndex`
    // would make the second call start scanning from where the first stopped
    // and miss a match near the top of its input. Same text twice must give the
    // same answer twice — this is the whole reason `lastIndex` is reset.
    const text = `x\n\nCo-${'authored'}-by: Claude <a@b.c>\n`;
    expect(findAttribution(text)).toEqual(findAttribution(text));
    expect(findAttribution(text).length).toBe(1);
  });

  it('says nothing when there is nothing to say', () => {
    expect(findAttribution('')).toEqual([]);
    expect(findAttribution(undefined as unknown as string)).toEqual([]);
    expect(formatAttributionFindings([], 'This commit message')).toBe('');
  });

  it('renders a message that names the file to open', () => {
    const rendered = formatAttributionFindings(
      findAttribution(`x\n\nCo-${'authored'}-by: Claude <a@b.c>`),
      'This commit message',
    );
    expect(rendered).toContain('This commit message');
    expect(rendered).toContain('0046');
  });
});

describe('the exemption list', () => {
  const tracked = trackedTextFiles();

  it('stays short, and every entry is a file the scan can reach', () => {
    // An exemption is a place the rule stops applying, so the count is pinned
    // in both directions: adding one has to be a deliberate edit here.
    expect(ATTRIBUTION_EXEMPT.length).toBeLessThanOrEqual(3);
    expect(ATTRIBUTION_EXEMPT.length).toBeGreaterThanOrEqual(2);

    for (const { path, reason } of ATTRIBUTION_EXEMPT) {
      // ⚠️ Every exempt path must cover something the scan can actually
      // **reach**. An entry is either a tracked file or a prefix of one — an
      // untracked path cannot reach the `git ls-files` walk below, so exempting
      // it does nothing, and asserting its existence fails wherever it is not
      // checked out. That is exactly how `.claude/skills/create-pr/SKILL.md`
      // failed this suite's first CI run while passing on the machine that
      // wrote it: `.claude/` is gitignored.
      expect(
        tracked.some(file => file === path || file.startsWith(path)),
        `${path} is exempt but matches no tracked file — an exemption only means something for a path the scan can reach`,
      ).toBe(true);
      expect(
        reason.length,
        `${path} must say why it is exempt`,
      ).toBeGreaterThan(15);
    }
  });

  it('matches on a path prefix, and only forward', () => {
    expect(isAttributionExempt('tools/conventions/attribution.mjs')).toBe(true);
    expect(isAttributionExempt('packages/business/ts/authz/src/index.ts')).toBe(
      false,
    );
  });
});

describe('no committed file carries attribution', () => {
  const files = trackedTextFiles();

  it('reads the repository it means to check', () => {
    // Pinned: if `git ls-files` stops answering — a detached worktree, a
    // renamed extension list — this suite would otherwise pass by checking
    // nothing at all, which is the failure mode it exists to prevent.
    expect(files.length).toBeGreaterThanOrEqual(500);
  });

  it('finds none outside the files that describe the rule', () => {
    const offending: string[] = [];
    for (const file of files) {
      if (isAttributionExempt(file)) continue;
      const findings = findAttribution(
        readFileSync(join(REPO_ROOT, file), 'utf8'),
      );
      for (const finding of findings) {
        offending.push(`${file}:${finding.line}  (${finding.id})`);
      }
    }
    expect(
      offending,
      `attribution in tracked files:\n  ${offending.join('\n  ')}`,
    ).toEqual([]);
  });
});

describe('the enforcement surfaces are wired to that predicate', () => {
  it('commitlint loads it and errors on it', () => {
    // The commit hook is the only surface that can stop a violation before it
    // exists. Asserting the wiring rather than re-running commitlint keeps this
    // spec fast; the rule's behaviour is covered by the predicate tests above.
    const config = readFileSync(
      join(REPO_ROOT, 'commitlint.config.mjs'),
      'utf8',
    );
    expect(config).toContain('tools/conventions/attribution.mjs');
    expect(config).toContain('no-ai-attribution');
    // Level 2 — an error. A warning would print and let the commit through.
    expect(config).toMatch(/'no-ai-attribution':\s*\[2,/);
    expect(
      existsSync(join(REPO_ROOT, 'commitlint.config.js')),
      'the CommonJS config must be gone, or two configs disagree',
    ).toBe(false);
  });

  it('CI checks the pull-request body, which no git hook can see', () => {
    const workflow = readFileSync(
      join(REPO_ROOT, '.github/workflows/pull_request_check.yml'),
      'utf8',
    );
    expect(workflow).toContain('tools/conventions/check-pull-request.mjs');
    expect(workflow).toContain('pnpm nx test @r10c/conventions');
    // Unconditional, like the catalog and documentation checks beside it: a
    // convention is everyone's problem regardless of which project a PR
    // touched, and `if: always()` is what stops an earlier failure hiding it.
    const step = workflow.slice(
      workflow.indexOf('tools/conventions/check-pull-request.mjs') - 400,
    );
    expect(step).toContain('if: always()');
  });

  it('the pull-request template asks for it too', () => {
    // Belt and braces, and the cheap half: the checklist is what a human reads
    // before the check tells them.
    const template = readFileSync(
      join(REPO_ROOT, '.github/PULL_REQUEST_TEMPLATE.md'),
      'utf8',
    );
    expect(template.toLowerCase()).toContain('attribution');
  });

  it('the rule is stated where an agent actually reads it', () => {
    // `CLAUDE.md` is the always-loaded context. The rule used to live one hop
    // away in `DEVELOPING.md`, which is why nothing ever contradicted the
    // session instruction that pushes the other way.
    const claudeMd = readFileSync(join(REPO_ROOT, 'CLAUDE.md'), 'utf8');
    expect(claudeMd).toContain('0046');
    expect(claudeMd.toLowerCase()).toContain('attribution');
  });
});
