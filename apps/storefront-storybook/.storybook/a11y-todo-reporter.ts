import { readFileSync } from 'node:fs';

import type { Reporter, TestModule } from 'vitest/node';

import todo from '../a11y-todo.json' with { type: 'json' };

interface StoryReport {
  readonly type: string;
  readonly result?: { readonly violations?: readonly unknown[] };
}

const titleOf = (path: string) =>
  /title: '([^']+)'/.exec(readFileSync(path, 'utf8'))?.[1];

/**
 * Fails the run when a title on `a11y-todo.json` raised no violation in any
 * cell (ADR 0075). The entry's issue has fixed it, or it was never needed, and
 * either way the list must say so by losing the entry — otherwise a title
 * would sit at `'todo'` and a new violation in it would pass unseen.
 *
 * Judged only for a title whose stories ran in every cell, so a run filtered
 * to one project or one file never calls an entry stale that another cell
 * still needs.
 */
export default class A11yTodoReporter implements Reporter {
  readonly #cells: readonly string[];

  constructor({ cells }: { readonly cells: readonly string[] }) {
    this.#cells = cells;
  }

  onTestRunEnd(modules: readonly TestModule[]) {
    const ranIn = new Map<string, Set<string>>();
    const violating = new Set<string>();
    for (const module of modules) {
      const title = titleOf(module.moduleId);
      if (title === undefined || !(title in todo)) continue;
      const cells = ranIn.get(title) ?? new Set<string>();
      // A browser project is named after its instance: `aurora-fluid (chromium)`.
      cells.add(module.project.name.replace(/ \(.*\)$/, ''));
      ranIn.set(title, cells);
      for (const test of module.children.allTests()) {
        const reports = (test.meta() as { reports?: readonly StoryReport[] })
          .reports;
        if (
          reports?.some(
            report =>
              report.type === 'a11y' &&
              (report.result?.violations?.length ?? 0) > 0,
          )
        ) {
          violating.add(title);
        }
      }
    }
    const stale = [...ranIn]
      .filter(([, cells]) => this.#cells.every(cell => cells.has(cell)))
      .map(([title]) => title)
      .filter(title => !violating.has(title));
    if (stale.length > 0) {
      for (const title of stale) {
        console.error(
          `a11y-todo.json: "${title}" raised no violation in any cell — delete its entry (it named ${(todo as Record<string, string>)[title]}).`,
        );
      }
      process.exitCode = 1;
    }
  }
}
