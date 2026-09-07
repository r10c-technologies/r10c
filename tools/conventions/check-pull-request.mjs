#!/usr/bin/env node
/**
 * The surface no git hook can reach: a pull-request body.
 *
 * `.husky/commit-msg` judges a commit message on the machine that writes it,
 * and that is the earliest possible moment — but a pull-request description is
 * composed on GitHub, after every hook has already run, and it is where the
 * "Generated with" line actually landed on every pull request that broke this
 * rule. So CI has to look, and it looks with the *same* predicate the
 * hook uses rather than a second regex that could disagree with it.
 *
 * It re-checks the branch's commit messages too. A hook is trivially bypassed
 * with `--no-verify`, and the point of a check is to be the thing that is not
 * negotiable at 2am.
 *
 * Reads its inputs from the environment because a body is arbitrary text: an
 * argument would have to survive shell quoting, and a body containing a
 * backtick or a `$(` is exactly the kind of input that turns a check into a
 * command injection.
 *
 *   PR_BODY       the pull request's description
 *   PR_BASE_SHA   what the branch is measured against (optional)
 *   PR_HEAD_SHA   the tip being proposed (optional)
 */
import { execFileSync } from 'node:child_process';

import { findAttribution, formatAttributionFindings } from './attribution.mjs';

/** Commit messages introduced by this branch, oldest first. */
function branchCommits(base, head) {
  if (!base || !head) return [];
  try {
    return execFileSync(
      'git',
      // `%B` is the raw body, `%x00` a separator no commit message contains.
      ['log', '--reverse', '--format=%H%x00%B%x00', `${base}..${head}`],
      { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
    )
      .split('\0')
      .reduce((commits, part, index, parts) => {
        if (index % 2 === 0 && parts[index + 1] !== undefined) {
          commits.push({ sha: part.trim(), message: parts[index + 1] });
        }
        return commits;
      }, []);
  } catch {
    // A shallow clone or an unreachable base is not a violation. The body check
    // above still ran, and failing here would make the check unreliable in
    // exactly the way that gets a check deleted.
    console.warn(
      `Could not read commits for ${base}..${head}; checked the body only.`,
    );
    return [];
  }
}

const problems = [];

const bodyFindings = findAttribution(process.env.PR_BODY ?? '');
if (bodyFindings.length > 0) {
  problems.push(
    formatAttributionFindings(bodyFindings, "This pull request's description"),
  );
}

for (const { sha, message } of branchCommits(
  process.env.PR_BASE_SHA,
  process.env.PR_HEAD_SHA,
)) {
  const findings = findAttribution(message);
  if (findings.length > 0) {
    problems.push(
      formatAttributionFindings(findings, `Commit ${sha.slice(0, 8)}`),
    );
  }
}

if (problems.length > 0) {
  console.error(problems.join('\n\n'));
  process.exit(1);
}

console.log('No AI attribution in the pull request body or its commits.');
