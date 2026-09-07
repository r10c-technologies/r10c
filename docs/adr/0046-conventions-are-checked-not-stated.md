# 46. A convention that is only stated is a convention that gets skipped

- Status: Accepted
- Date: 2026-09-07

## Context

This repository is unusually good at making its rules executable. The store
register is a test (`@r10c/slices`). The documentation's claims are a test
(`@r10c/docs-check`). Catalog parity, error-code coverage, module boundaries,
generated tables — each one is a check that fails a build rather than a sentence
someone is expected to remember.

The conventions about **how we work** got none of that, and one of them broke in
a way worth recording, because the failure is not "someone forgot".

### Measured

The rule is: no AI/tool co-author trailers or "generated with" lines on commits,
pull requests or documentation. It is written in three independent places:

| Where                                    | How many times             |
| ---------------------------------------- | -------------------------- |
| `docs/DEVELOPING.md`, `## Commits & PRs` | once                       |
| `.claude/skills/create-pr/SKILL.md`      | **four** times in one file |
| The maintainer's own working notes       | once, with the reasoning   |

And it was broken anyway. Measured with the predicate this record introduces,
rather than with a loose search for the vendor's name:

- **5 of the last 40 merged pull requests** carry it in the description —
  #192, #200, #203, #205, #211.
- **6 of the last 60 commits on `main`** carry it as a parsed trailer —
  `65bd81f`, `648328c`, `4d9486f`, `4c6b4bc`, `ec15431`, `fc61853`.

⚠️ The first count of this was **wrong, in the direction that flatters the
argument**: a case-insensitive grep for `claude|anthropic|generated with` reported
eleven consecutive pull requests, because several of them discuss the tool in
prose without being attributed. The narrow patterns below find five. Recorded
because a check justified by an inflated number is the same failure it is
supposed to prevent.

Nothing executable looked. Specifically:

- `commitlint.config.js` was three lines and had **no `rules` block at all**. The
  conventional and Nx-scope presets it extends are shaped entirely around the
  subject line — type, scope, case, length — so nothing had ever inspected a
  body or a trailer.
- `.husky/commit-msg` ran exactly one command, commitlint.
- No CI step read a commit message or a pull-request body. No workflow references
  `github.event.pull_request.body`.
- The rule was **absent from `CLAUDE.md`**, the always-loaded context. It lived
  one hop away, behind a router line reading "…conventions, commits".

### Why prose lost

The interesting part is not that an instruction was missed. It is that the
instruction was **contradicted**, on a schedule, by something with better
placement.

An agent session begins with a reminder that supplies attribution trailers and
states that it "replaces any earlier attribution guidance". It fires
unconditionally, every session, in the context window's most privileged position.
Against that, a rule sitting in a document that is only read when someone follows
a link loses — and it lost repeatedly without anybody noticing, because the
violation is a trailer at the bottom of a message nobody re-reads.

This generalizes past attribution, which is the reason for a record rather than a
patch. Any convention whose only enforcement is that people remember it is one
well-placed contradiction away from being gone, and the repository will not
notice, because "not enforced" and "enforced and passing" look identical from
the outside.

## Decision

**A working convention gets a check, and the check owns one predicate that every
surface calls.**

### One predicate

`tools/conventions/attribution.mjs` exports `findAttribution(text)` and nothing
stateful. Plain `.mjs` with no build step, because it is imported by
`commitlint.config.mjs` — which runs from a git hook, long before anything in
`dist` exists — and by a spec. That is the shape `tools/sync-docs.mjs` already
has: a script the pipeline runs and a spec imports, so the rule a developer's
commit is judged by and the rule CI asserts can never become two rules.

### Three surfaces, because no one of them can see everything

| Surface                                         | Sees                               | Cannot see                         |
| ----------------------------------------------- | ---------------------------------- | ---------------------------------- |
| `commitlint.config.mjs` (`.husky/commit-msg`)   | a commit message, before it exists | a pull-request body; `--no-verify` |
| `tools/conventions/check-pull-request.mjs` (CI) | the body, and the branch's commits | anything before the PR is opened   |
| `@r10c/conventions` (CI)                        | every committed file               | metadata that is not in the tree   |

The commit hook is the earliest and most useful; it is also trivially bypassed,
which is why the CI step re-checks the same commits. The spec covers the third
case the other two structurally cannot: text that is already committed.

### The patterns are anchored on structure, not on a vendor's name

A matcher for the word "Claude" would fire on `.claude/`, on skill documentation
and on editor configuration — all legitimate — and a check that cries wolf is
turned off within a week. So the patterns key on trailers, on a vendor no-reply
address, on a session link and on a "Generated with" line.

⚠️ **The canonical casing is git's, not the documentation's.** Every real
violation reads `Co-authored-by:` — lowercase `authored` — because that is what
`git interpret-trailers` writes. A pattern matching only the title-cased
`Co-Authored-By:` that the documentation and the session reminder both use would
have matched **none** of the six commits on `main`, while looking exactly right
in review.

### Exemptions are listed, with reasons, and pinned

Two tracked paths must contain the forbidden strings to do their job: the
predicate itself (with its fixtures) and this record. They are named in
`ATTRIBUTION_EXEMPT` with a reason each, and the spec pins the list's length in
**both** directions — an exemption is a place the rule stops applying, so adding
one has to be a visible edit rather than a quiet append.

⚠️ **An exemption only means something for a path the scan can reach**, and the
first CI run proved it. The `create-pr` skill was exempted too — it instructs an
agent using the literal text — but `.claude/` is gitignored, so `git ls-files`
never lists it, the exemption did nothing, and the "every exemption still
exists" assertion failed on a checkout that does not contain the file while
passing on the machine that wrote it. The list now holds tracked paths only, and
the spec asserts that rather than mere existence.

### The rule also moves into `CLAUDE.md`

Not as belt and braces: as the actual fix for _why_ it was skipped. The session
reminder wins on placement, so the counter-instruction has to be somewhere with
comparable placement. A rule an agent never loads cannot contradict one it always
loads.

### The remedy for what already happened is asymmetric

The five pull-request bodies are GitHub metadata and are edited in place. The
six commit messages on `main` **stay**. Rewriting them means force-pushing the
default branch, which detaches every clone and every open branch — a cost wildly
out of proportion to a trailer, and one that this repository's own "no
force-push" convention forbids anyway.

## Alternatives rejected

**A custom ESLint rule**, the way `no-foreign-app-namespace.mjs` enforces the
i18n namespace boundary. ESLint only ever sees source files. It cannot see a
commit message, and it cannot see a pull-request body — the two places every
actual violation occurred. It would check the one surface that was never the
problem.

**A Claude Code hook** (`PreToolUse` on `Bash`, refusing a `git commit` carrying
a trailer). Tempting, because the hook surface is entirely empty today — no
hooks are configured in the project settings or the user settings. Rejected
because it binds one agent on one machine: it does nothing for a second
contributor, a different tool, or CI, and a guard whose coverage depends on whose
laptop is being used is not a guard. The commit hook is the same idea at a layer
everyone shares.

**Just restating the rule more loudly.** This is what the last three sites
already were. A fourth would be a fourth thing to lose to the same reminder.

**A `prepare-commit-msg` hook that strips the trailer automatically.** Silently
rewriting a message hides that the convention was almost broken, and the same
agent goes on emitting it forever. Failing is what causes the behaviour to
change.

## Consequences

- **Adding the second convention is cheap and the shape is set**: a predicate
  beside `attribution.mjs`, a case in `conventions.spec.ts`, and — only if the
  convention concerns something outside the working tree — a surface in the
  commit hook or the CI script.
- **`commitlint.config.js` became `commitlint.config.mjs`.** A CommonJS config
  cannot statically import an ES module and cannot use a top-level `await` to
  get one. The spec asserts the `.js` file is gone, because two commitlint
  configs would resolve unpredictably and only one of them has the rule.
- **`@r10c/slices` now runs unconditionally in CI**, beside `@r10c/docs-check`
  and `@r10c/i18n-check`. It was reachable only through the affected matrix, so a
  pull request that broke a slice invariant without touching `tools/slices`
  passed. Not this record's subject, but exactly its shape: a check that exists
  and is not always asked.
- **A false positive is possible and the remedy is deliberate.** Someone quoting
  a trailer in a genuine document will fail the check and will have to add an
  exemption with a reason. That friction is intended; the alternative is a
  pattern loose enough to stop meaning anything.
- **This does not make the repository hostile to AI assistance.** It records that
  the assistance is not an author, which is the maintainer's call about their own
  history.

## Related

- [ADR 0025](0025-where-planning-and-business-knowledge-live.md) — the four
  artifacts and their one job each. This record is about the fifth kind of
  knowledge those four do not hold: how we work, as opposed to what we decided.
- `docs/DEVELOPING.md`, `## Commits & PRs` — the prose the check now backs.
