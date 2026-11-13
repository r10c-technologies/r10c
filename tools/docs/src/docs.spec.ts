/**
 * The documentation checks that cannot be generated.
 *
 * `tools/sync-docs.mjs` owns the three tables that have a machine-readable
 * source. This file holds the rest: the prose stays hand-written, and these
 * assertions fail the build when an identifier inside it stops existing.
 *
 * Every regex-driven check pins the number of matches it expects. A matcher
 * that silently stops matching would otherwise turn the whole file green while
 * asserting nothing — the failure mode `slices.spec.ts` guards the same way.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import {
  ENVOY_FILE,
  envoyConfig,
  gatewayManifests,
  HEARTBEAT_S,
  REALTIME,
  renderEdge,
  UPSTREAM_OFFSET,
  type Yaml,
} from '@r10c/edge';
import {
  declaredEntityClasses,
  declaredEntityDomains,
  SLICES,
} from '@r10c/slices';
import { describe, expect, it } from 'vitest';

import {
  ADR_AREAS,
  adrs,
  allDocs,
  deepDocs,
  headingSlugs,
  localLinks,
  read,
  REPO_ROOT,
} from './corpus.js';

/** The one entifix version the catalog pins, e.g. `0.2.0`. */
const catalogEntifixVersion = (): string => {
  const pinned = read('pnpm-workspace.yaml').match(
    /'@entifix\/core':\s*([0-9][^\s]*)/,
  )?.[1];
  if (!pinned) throw new Error('pnpm-workspace.yaml pins no @entifix/core');
  return pinned;
};

/**
 * The `dist` of every entifix package this checkout installs, one per package.
 *
 * Read out of pnpm's virtual store, because only the packages the root itself
 * depends on are linked at the top of `node_modules`. pnpm keeps one directory
 * per resolved peer set; they hold the same files, so the first one found for a
 * name is enough.
 *
 * ⚠️ **Only the catalog's version.** The store keeps the directories of earlier
 * installs — every release this checkout ever resolved, and every `file:` copy
 * a swap left behind — and they sort before the current one. Reading the first
 * match for a name read entifix 0.1.3's Effect 3 build on a checkout already on
 * 0.2.0, and passed locally while the same check failed in CI.
 */
const installedEntifixDists = (): string[] => {
  const store = join(REPO_ROOT, 'node_modules', '.pnpm');
  const version = catalogEntifixVersion();
  const byName = new Map<string, string>();
  for (const entry of readdirSync(store).sort()) {
    if (!/^@entifix\+[a-z0-9-]+@/.test(entry)) continue;
    if (!entry.split('_')[0].endsWith(`@${version}`)) continue;
    const scope = join(store, entry, 'node_modules', '@entifix');
    if (!existsSync(scope)) continue;
    for (const name of readdirSync(scope)) {
      const dist = join(scope, name, 'dist');
      if (!byName.has(name) && existsSync(dist)) byName.set(name, dist);
    }
  }
  return [...byName.values()];
};

/** `dist` path of one installed entifix package, e.g. `amqp`. */
const installedEntifixDist = (name: string): string => {
  const dist = installedEntifixDists().find(dir =>
    dir.endsWith(join('@entifix', name, 'dist')),
  );
  if (!dist) throw new Error(`@entifix/${name} is not installed`);
  return dist;
};

/** Adds every type-ish name a tree of `.d.ts` files declares to `found`. */
const walkDeclarations = (dir: string, found: Set<string>): void => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDeclarations(full, found);
    } else if (entry.name.endsWith('.d.ts')) {
      for (const match of readFileSync(full, 'utf8').matchAll(
        /\b(?:class|interface|type|enum|function|const)\s+([A-Z]\w+)/g,
      )) {
        found.add(match[1]);
      }
    }
  }
};

describe('Links resolve', () => {
  it('finds the documents it is meant to check', () => {
    // 2 roots + 6 deep docs + 4 shared snippets + the ADR README + 23 records.
    expect(allDocs().length).toBeGreaterThanOrEqual(30);
    expect(deepDocs()).toContain('ARCHITECTURE.md');
  });

  it('points every relative link at a file that exists', () => {
    const broken: string[] = [];

    for (const doc of allDocs()) {
      const text = read(doc);
      for (const { target } of localLinks(text)) {
        if (!target) continue; // a same-document anchor; checked below
        const resolved = resolve(join(REPO_ROOT, dirname(doc)), target);
        if (!existsSync(resolved)) broken.push(`${doc} → ${target}`);
      }
    }

    expect(broken, `broken relative links:\n  ${broken.join('\n  ')}`).toEqual(
      [],
    );
  });

  it('points every in-repo anchor at a heading that exists', () => {
    const broken: string[] = [];

    for (const doc of allDocs()) {
      const text = read(doc);
      for (const { target, hash } of localLinks(text)) {
        if (!hash) continue;
        // An empty target means the anchor points inside this same document.
        const resolved = target
          ? resolve(join(REPO_ROOT, dirname(doc)), target)
          : join(REPO_ROOT, doc);
        if (!existsSync(resolved) || statSync(resolved).isDirectory()) continue;
        if (!resolved.endsWith('.md')) continue;
        const slugs = headingSlugs(readFileSync(resolved, 'utf8'));
        if (!slugs.has(hash)) broken.push(`${doc} → ${target}#${hash}`);
      }
    }

    expect(broken, `broken anchors:\n  ${broken.join('\n  ')}`).toEqual([]);
  });
});

describe('CLAUDE.md is a working router', () => {
  const claude = () => read('CLAUDE.md');

  it('resolves every @import', () => {
    const imports = [...claude().matchAll(/^@(\S+\.md)$/gm)].map(m => m[1]);

    // The four operational snippets. If this drops to zero the check below is
    // asserting nothing.
    expect(imports.length).toBeGreaterThanOrEqual(4);

    for (const target of imports) {
      expect(
        existsSync(join(REPO_ROOT, target)),
        `CLAUDE.md @imports '${target}', which does not exist`,
      ).toBe(true);
    }
  });

  it('lists every deep doc in the router table, and nothing that is gone', () => {
    const text = claude();
    for (const doc of deepDocs()) {
      expect(
        text.includes(`docs/${doc}`),
        `docs/${doc} exists but CLAUDE.md's documentation map does not link it`,
      ).toBe(true);
    }
  });
});

describe('README.md agrees with the router', () => {
  it('links every deep doc', () => {
    const text = read('README.md');
    for (const doc of deepDocs()) {
      expect(
        text.includes(`docs/${doc}`),
        `docs/${doc} exists but README's documentation table does not link it`,
      ).toBe(true);
    }
  });
});

/**
 * What is wrong with the links in CLAUDE.md's "entifix decisions r10c follows"
 * section, given the entifix version the catalog installs.
 *
 * The records are not in any tarball, so "resolves" cannot be checked from
 * `node_modules`, and a network fetch would make an unconditional CI job flaky.
 * What is checked instead is that every link names the **tag** of the installed
 * release: bumping the catalog without re-pinning the list fails, so the list
 * cannot describe a framework other than the one the code runs on.
 */
const ENTIFIX_ADR_LINK =
  /\]\((https:\/\/github\.com\/r10c-technologies\/entifix\/[^)\s]+)\)/g;

const entifixAdrLinkProblems = (section: string, version: string): string[] => {
  const expected = new RegExp(
    `^https://github\\.com/r10c-technologies/entifix/blob/v${version.replaceAll('.', '\\.')}/docs/adr/\\d{4}-[a-z0-9-]+\\.md$`,
  );
  return [...section.matchAll(ENTIFIX_ADR_LINK)]
    .map(match => match[1])
    .filter(url => !expected.test(url));
};

const entifixAdrSection = (text: string): string => {
  const start = text.indexOf('\n## entifix decisions r10c follows\n');
  if (start === -1) return '';
  const next = text.indexOf('\n## ', start + 1);
  return text.slice(start, next === -1 ? undefined : next);
};

describe("CLAUDE.md's entifix decisions are pinned to the installed release", () => {
  const section = entifixAdrSection(read('CLAUDE.md'));
  const version = catalogEntifixVersion();
  const urls = [...section.matchAll(ENTIFIX_ADR_LINK)].map(match => match[1]);

  it('finds the records it is meant to check', () => {
    expect(urls.length).toBeGreaterThanOrEqual(5);
  });

  it(`links every record at the v${version} tag`, () => {
    expect(
      entifixAdrLinkProblems(section, version),
      `these entifix ADR links do not name the installed tag v${version} — ` +
        'adopting a release re-pins the whole list:',
    ).toEqual([]);
  });

  it('rejects a link that floats on a branch or names another release', () => {
    const base = 'https://github.com/r10c-technologies/entifix/blob';
    const planted = [
      `- [a](${base}/main/docs/adr/0001-the-tier-contract.md)`,
      `- [b](${base}/v0.0.1/docs/adr/0001-the-tier-contract.md)`,
      `- [c](${base}/v${version}/docs/adr/0001-the-tier-contract.md)`,
    ].join('\n');

    expect(entifixAdrLinkProblems(planted, version)).toHaveLength(2);
  });

  // A checkout with the swap kit's clone can prove the file exists at the tag;
  // CI has no clone and stays offline, which is why the tag pin above is the
  // check that always runs.
  it.runIf(existsSync(join(REPO_ROOT, '.entifix', '.git')))(
    'names files that exist at that tag in the local clone',
    () => {
      const missing = urls.filter(url => {
        const path = url.split(`/blob/v${version}/`)[1];
        try {
          execFileSync(
            'git',
            [
              '-C',
              join(REPO_ROOT, '.entifix'),
              'cat-file',
              '-e',
              `v${version}:${path}`,
            ],
            { stdio: 'ignore' },
          );
          return false;
        } catch {
          return true;
        }
      });

      expect(
        missing,
        `these links name no file at v${version} in .entifix/ — a misspelt ` +
          'record, or a clone that needs `git -C .entifix fetch --tags`:',
      ).toEqual([]);
    },
  );
});

describe('ADR records are reachable and consistent', () => {
  const records = adrs();
  const byId = new Map(records.map(record => [record.id, record]));

  it('finds the records it is meant to check', () => {
    expect(records.length).toBeGreaterThanOrEqual(23);
    expect(records.every(r => r.status.length > 0)).toBe(true);
  });

  it('cites every Accepted record from the router or a doc', () => {
    const prose = allDocs()
      .filter(doc => !doc.startsWith(join('docs', 'adr')))
      .map(doc => read(doc))
      .join('\n');

    const orphans = records
      .filter(record => record.status === 'Accepted')
      .filter(record => !prose.includes(record.file))
      .map(record => record.file);

    expect(
      orphans,
      'these Accepted ADRs are cited by no doc, so nothing routes a reader to ' +
        `them:\n  ${orphans.join('\n  ')}`,
    ).toEqual([]);
  });

  it('references only ADR files that exist', () => {
    const missing: string[] = [];

    for (const doc of allDocs()) {
      for (const match of read(doc).matchAll(/(\d{4}-[a-z0-9-]+\.md)/g)) {
        if (!byId.has(match[1].slice(0, 4)))
          missing.push(`${doc} → ${match[1]}`);
      }
    }

    expect(
      missing,
      `references to missing ADRs:\n  ${missing.join('\n  ')}`,
    ).toEqual([]);
  });

  /**
   * The rule this project exists for.
   *
   * Supersession written only forward leaves a reader who opens the old record
   * seeing `Status: Accepted` and no marker — which is how ADR 0004 went on
   * describing a password-reset flow that ADR 0016 had deleted.
   */
  describe('supersession is symmetric', () => {
    /**
     * Claims of the form "supersedes ADR 0002", scoped to one sentence so an
     * unrelated ADR mentioned later in the paragraph is not swept in.
     */
    const claims = (record: (typeof records)[number]) => {
      const found = new Set<string>();
      for (const sentence of record.text.split(/(?<=[.!?])\s+/)) {
        // Verb forms only. The bare noun "**Amendment.**" is a section label
        // this corpus uses to introduce a correction, and ADR 0016 opens such a
        // paragraph by citing ADR 0008 for whose job the saga is — a mention,
        // not a supersession.
        if (
          !/\b(supersedes?|superseded|superseding|amends?|amended)\b/i.test(
            sentence,
          )
        ) {
          continue;
        }

        // "extends ADR 0016 and supersedes nothing" asserts the *absence* of a
        // supersession. Used verbatim by 0017 and 0019.
        if (/supersedes nothing/i.test(sentence)) continue;

        // Direction matters, and most sentences here are passive. "Superseded
        // by [ADR 0020]" and "- Amended by: [ADR 0020]" name the record doing
        // the overriding, so this record is the *target* — the sentence already
        // IS the reciprocal, and reading it as a forward claim would demand a
        // back-link pointing the wrong way.
        if (/\bby:?\s*\[?ADR \d{4}/i.test(sentence)) continue;

        for (const match of sentence.matchAll(/ADR (\d{4})/g)) {
          if (match[1] !== record.id) found.add(match[1]);
        }
      }
      return [...found];
    };

    it('still recognises the claims it is meant to check', () => {
      // The five forward claims in the corpus as of 2026-08-13. Every one of
      // them was one-way when this check was written, which is the whole
      // reason it exists:
      //
      //   0015 → 0002   RS256 replaces `jwt.secret`
      //   0016 → 0004   recovery and lockout move to the provider
      //   0018 → 0016   the `ensureLoginVersion` reasoning
      //   0021 → 0008   the host table and the 300N/310N pairing
      //   0023 → 0006   the ambient-tenancy section is amended
      //
      // Asserted as a **subset**, not an exact set: a new ADR that supersedes
      // an old one correctly must not fail this test, only an added claim that
      // is one-way (which the next test catches) or a matcher that has stopped
      // matching (which this one does).
      const pairs = new Set(
        records.flatMap(r => claims(r).map(t => `${r.id}->${t}`)),
      );

      for (const known of [
        '0015->0002',
        '0016->0004',
        '0018->0016',
        '0021->0008',
        '0023->0006',
      ]) {
        expect(
          pairs.has(known),
          `the matcher no longer sees the ${known} supersession; if it was not ` +
            'deliberately reworded, every assertion below is passing vacuously',
        ).toBe(true);
      }
    });

    it('exempts the "supersedes nothing" phrasing', () => {
      for (const id of ['0017', '0019']) {
        const record = byId.get(id);
        if (!record) throw new Error(`ADR ${id} is missing`);
        expect(
          claims(record),
          `ADR ${id} says it supersedes nothing; the matcher should read no ` +
            'claim out of it',
        ).toEqual([]);
      }
    });

    it('leaves the reciprocal line on every record it overrode', () => {
      const oneWay: string[] = [];

      for (const record of records) {
        for (const target of claims(record)) {
          const overridden = byId.get(target);
          if (!overridden) continue;
          if (!overridden.revisedBy.includes(record.id)) {
            oneWay.push(
              `ADR ${record.id} claims to supersede/amend ADR ${target}, but ` +
                `${overridden.file} carries no "- Revised: … by [ADR ${record.id}]" ` +
                'line — a reader opening it sees no marker',
            );
          }
        }
      }

      expect(
        oneWay,
        `one-way supersessions:\n  ${oneWay.join('\n  ')}`,
      ).toEqual([]);
    });
  });
});

/**
 * The router is a router again, and this is what stops it becoming a digest.
 *
 * `CLAUDE.md` is loaded into every session and every subagent, so a paragraph
 * added here costs more than the same paragraph anywhere else in the repo. It
 * once carried a hand-written summary of every ADR — 170KB, 88% of it a digest
 * of records that already said the same thing — which is a cost nobody sees
 * because nothing measures it. These checks measure it.
 */
describe("The router's decision index", () => {
  const records = adrs();
  const claude = () => read('CLAUDE.md');

  it('files every record under a declared area, with a symptom to read it for', () => {
    // `adrs()` throws on a missing or unknown header, so reaching this point
    // already proves both exist. What is asserted here is that they are usable:
    // an area the index renders, and a line long enough to name a symptom.
    const thin = records.filter(record => record.readWhen.length < 40);

    expect(records.length).toBeGreaterThanOrEqual(51);
    expect(
      thin.map(record => record.file),
      'these records carry a "- Read when:" too short to name a symptom, which ' +
        'is the only thing that makes a reader open them:\n  ' +
        `${thin.map(r => r.file).join('\n  ')}`,
    ).toEqual([]);
    expect(
      records.every(record =>
        (ADR_AREAS as readonly string[]).includes(record.area),
      ),
    ).toBe(true);
  });

  it('does not repeat the words the index already prints around it', () => {
    // The generated line reads "… — read when <readWhen>.", so a record whose
    // header opens with "read when" or "before" renders as "read when before
    // putting tenant data in Postgres" and ends in a doubled full stop.
    const awkward = records.filter(
      record =>
        /^(read when|when|before)\b/i.test(record.readWhen) ||
        /[.!?]$/.test(record.readWhen),
    );

    expect(
      awkward.map(record => record.file),
      'a "- Read when:" is a clause the index completes, not a sentence:\n  ' +
        `${awkward.map(r => r.file).join('\n  ')}`,
    ).toEqual([]);
  });

  it('routes to every record from the generated index', () => {
    const text = claude();
    const unlisted = records.filter(
      record => !text.includes(`docs/adr/${record.file}`),
    );

    expect(
      unlisted.map(record => record.file),
      'these records are not in the decision index, so nothing sends a reader ' +
        `to them:\n  ${unlisted.map(r => r.file).join('\n  ')}`,
    ).toEqual([]);
  });

  it('keeps the router small enough to be worth loading every session', () => {
    // A ceiling, not a target. It was 170KB before the digest moved into the
    // records it duplicated; ~26KB after, plus ~30KB of `@import`ed snippets.
    // Raise this only with a reason — every byte here is paid on every turn of
    // every session, by the main thread and each subagent alike.
    const CEILING = 40_000;
    const size = Buffer.byteLength(claude(), 'utf8');

    expect(
      size,
      `CLAUDE.md is ${size} bytes, past the ${CEILING} ceiling. It is a ` +
        'router: a decision belongs in an ADR with a "- Read when:" header, a ' +
        'mechanism belongs in the doc that owns it, and only a rule that ' +
        'overrides a default and lives nowhere else belongs here.',
    ).toBeLessThanOrEqual(CEILING);
  });
});

describe('The business map matches the entities that exist', () => {
  const domains = declaredEntityDomains();
  const classes = declaredEntityClasses();

  it('finds the entity declarations it is meant to check', () => {
    expect(domains.size).toBeGreaterThanOrEqual(11);
    expect(classes.size).toBeGreaterThanOrEqual(28);
  });

  it('names every entity-owning domain in BUSINESS-ARCHITECTURE', () => {
    const text = read('docs/BUSINESS-ARCHITECTURE.md');
    const missing = [...domains.keys()].filter(
      domain => !text.includes(domain),
    );

    expect(
      missing,
      'these domains own entities but the capability map never names them:\n' +
        `  ${missing.join('\n  ')}`,
    ).toEqual([]);
  });

  /**
   * The check that would have caught the drift this whole effort started from:
   * README claimed `product-configuration-management` owned
   * `Product`/`ProductBrand`/`ProductCategory` long after ADR 0022 moved two of
   * them and deleted the third.
   */
  /**
   * Names the business docs may use that are deliberately **not** declared in
   * this repository. Everything here is either TM Forum SID vocabulary — the
   * glossary's whole job is to name the standard concept beside our class — or
   * a concept from a Proposed ADR that has not been built.
   *
   * A name is added here only with a reason. The alternative is a suffix
   * allowlist, which was the first attempt and was worse: it would not have
   * caught `Product`, the exact ghost this check exists for.
   */
  const EXTERNAL_VOCABULARY = new Set([
    'Party', // SID: the supertype of Individual and Organization
    'Customer', // SID: a party role, modelled here as PartyRole
    'CharacteristicValue', // SID: named by ADR 0014, not built
    'PricingLogicAlgorithm', // SID: named for future pricing, not built
    'Crossing', // ADR 0012 (Proposed): the audited cross-tenant record
    'VendorCategory', // a concept in the capability map, not an entity
    'Product', // SID: the instance a buyer owns. Our catalog record is
    // `ProductSpecification`; ADR 0022 renamed the entity for
    // exactly this reason, and the glossary has to name both.
  ]);

  /**
   * The exemptions apply to the **glossary only**.
   *
   * `Product` is the case that forces the distinction: naming it in
   * BUSINESS-ARCHITECTURE is the glossary doing its job, and naming it in
   * README's entity list is the drift that started all of this. A single global
   * allowlist would have to permit both.
   */
  const GLOSSARY = 'docs/BUSINESS-ARCHITECTURE.md';

  /** Every type-ish name declared anywhere in the workspace's source. */
  const declaredIdentifiers = (): Set<string> => {
    const found = new Set<string>();
    const skip = new Set([
      'node_modules',
      'dist',
      'out-tsc',
      '.next',
      'test-output',
    ]);
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (skip.has(entry.name)) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (/\.tsx?$/.test(entry.name)) {
          // Specs are excluded deliberately. `Product` still exists in five of
          // them as a throwaway fixture class, and counting those would let the
          // docs go on naming an entity the business layer deleted — which is
          // exactly the drift this check was written for.
          if (/\.spec\.tsx?$/.test(entry.name)) continue;
          const text = readFileSync(full, 'utf8');
          for (const match of text.matchAll(
            /\b(?:class|interface|type|enum|function|const)\s+([A-Z]\w+)/g,
          )) {
            found.add(match[1]);
          }
        }
      }
    };
    for (const root of ['packages', 'apps']) walk(join(REPO_ROOT, root));
    // entifix is installed rather than in the tree, so what it declares is read
    // from the declarations it ships. A name the docs use from the framework is
    // as real as one r10c declares — and one entifix renamed is as stale.
    for (const dir of installedEntifixDists()) walkDeclarations(dir, found);
    return found;
  };

  it('names nothing in the business docs that the source does not declare', () => {
    const identifiers = declaredIdentifiers();
    expect(
      identifiers.size,
      'no identifiers were found; the scan has broken and this check is ' +
        'passing vacuously',
    ).toBeGreaterThanOrEqual(500);

    const ghosts: string[] = [];
    for (const doc of ['README.md', GLOSSARY]) {
      for (const match of read(doc).matchAll(/`([A-Z][a-zA-Z]{4,})`/g)) {
        const name = match[1];
        if (identifiers.has(name)) continue;
        if (doc === GLOSSARY && EXTERNAL_VOCABULARY.has(name)) continue;
        ghosts.push(`${doc}: ${name}`);
      }
    }

    expect(
      ghosts,
      'these names appear in the business docs but nothing in packages/ or ' +
        'apps/ declares them. Either the code was renamed and the doc was not, ' +
        'or the name is external vocabulary and belongs in ' +
        `EXTERNAL_VOCABULARY with a reason:\n  ${ghosts.join('\n  ')}`,
    ).toEqual([]);
  });

  it('still resolves the entity classes the docs do name', () => {
    const named = [...classes.keys()].filter(name =>
      read('docs/BUSINESS-ARCHITECTURE.md').includes(name),
    );
    expect(
      named.length,
      'the business architecture names no entity class at all',
    ).toBeGreaterThanOrEqual(20);
  });
});

/**
 * The one place these checks compare a doc to another doc.
 *
 * `tools/sync-docs.mjs` declares which blocks it generates, and two documents
 * describe that list in prose: the `CLAUDE.md` router and DEVELOPING.md's
 * "Keeping the documentation true". Three copies of one list is exactly the
 * duplication the rest of this work exists to remove — but the two prose copies
 * earn their place (a reader needs the list where they already are), so the
 * answer is to make them **checked** rather than to argue about them.
 */
describe('The generated-block list agrees everywhere it is written', () => {
  // A dynamic path on purpose: a static relative import would cross an Nx
  // project boundary, and `tools/sync-docs.mjs` is a script rather than a
  // project. Importing it is safe — its `main()` is guarded to script runs.
  const blocks = async (): Promise<{ name: string; file: string }[]> => {
    const module = await import(join(REPO_ROOT, 'tools', 'sync-docs.mjs'));
    return module.BLOCKS;
  };

  it('finds the blocks it is meant to check', async () => {
    const declared = await blocks();
    expect(declared.length).toBeGreaterThanOrEqual(3);
    expect(declared.every(b => b.name && b.file)).toBe(true);
  });

  it('names every generated block in the router and in DEVELOPING.md', async () => {
    const declared = await blocks();
    const missing: string[] = [];

    for (const doc of ['CLAUDE.md', 'docs/DEVELOPING.md']) {
      const text = read(doc);
      for (const block of declared) {
        if (!text.includes(block.name)) missing.push(`${doc}: ${block.name}`);
      }
    }

    expect(
      missing,
      'sync-docs.mjs generates these blocks but the prose describing the ' +
        'mechanism never names them. Add the block where it is missing — a ' +
        `list nothing checks is a list that goes stale:\n  ${missing.join('\n  ')}`,
    ).toEqual([]);
  });

  it('writes every generated block into a file that exists and carries its markers', async () => {
    const broken: string[] = [];

    for (const block of await blocks()) {
      const text = read(block.file);
      for (const marker of [
        `<!-- docs:begin ${block.name} -->`,
        `<!-- docs:end ${block.name} -->`,
      ]) {
        if (!text.includes(marker)) broken.push(`${block.file}: ${marker}`);
      }
    }

    expect(broken, `missing block markers:\n  ${broken.join('\n  ')}`).toEqual(
      [],
    );
  });
});

describe('Tag dimensions are documented', () => {
  const layering = read('docs/_shared/layering.md');

  const declaredTags = (): Set<string> => {
    const found = new Set<string>();
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (
          ['node_modules', 'dist', 'out-tsc', '.next', '.git'].includes(
            entry.name,
          )
        ) {
          continue;
        }
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.name === 'package.json') {
          try {
            const pkg = JSON.parse(readFileSync(full, 'utf8'));
            for (const tag of pkg?.nx?.tags ?? []) found.add(tag);
          } catch {
            // A package.json that does not parse is someone else's failure.
          }
        }
      }
    };
    for (const root of ['apps', 'packages', 'tools']) {
      walk(join(REPO_ROOT, root));
    }
    return found;
  };

  it('finds the tags it is meant to check', () => {
    expect(declaredTags().size).toBeGreaterThanOrEqual(10);
  });

  it('documents every tag dimension in use', () => {
    const missing = [...declaredTags()]
      .map(tag => tag.split(':')[0])
      .filter((dimension, index, all) => all.indexOf(dimension) === index)
      .filter(dimension => !layering.includes(`\`${dimension}:`))
      .filter(dimension => dimension !== 'type');

    expect(
      missing,
      'these tag dimensions are declared in nx.tags but layering.md never ' +
        `explains them:\n  ${missing.join('\n  ')}`,
    ).toEqual([]);
  });
});

/**
 * A cell's technology is what its import bans are keyed on, so a cell carrying
 * none is a cell no ban reaches, and one carrying two is held to both lists at
 * once. Its scope says which slice's domain it is — never the shared core
 * (ADR 0060).
 */
describe('Implementation cells declare one technology and a domain scope', () => {
  const cells = (): { name: string; tags: string[] }[] => {
    const root = join(REPO_ROOT, 'packages', 'implementation');
    if (!existsSync(root)) return [];
    return readdirSync(root, { withFileTypes: true })
      .filter(key => key.isDirectory())
      .flatMap(key =>
        readdirSync(join(root, key.name), { withFileTypes: true })
          .filter(tech => tech.isDirectory())
          .map(tech => join(root, key.name, tech.name, 'package.json'))
          .filter(manifest => existsSync(manifest)),
      )
      .map(manifest => {
        const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
        return { name: pkg.name as string, tags: pkg?.nx?.tags ?? [] };
      });
  };

  it('finds the cells it is meant to check', () => {
    expect(cells().length).toBeGreaterThanOrEqual(2);
  });

  it('gives every cell exactly one tech:* tag', () => {
    const wrong = cells().filter(
      cell => cell.tags.filter(tag => tag.startsWith('tech:')).length !== 1,
    );

    expect(
      wrong.map(cell => cell.name),
      'these cells carry no tech:* tag, or more than one:',
    ).toEqual([]);
  });

  it('gives every cell a domain scope, never the shared core', () => {
    const wrong = cells().filter(
      cell =>
        cell.tags.filter(
          tag => tag.startsWith('scope:') && tag !== 'scope:shared',
        ).length !== 1 || cell.tags.includes('scope:shared'),
    );

    expect(
      wrong.map(cell => cell.name),
      'these cells carry no domain scope, more than one, or scope:shared:',
    ).toEqual([]);
  });

  it('names every cell for its key and technology', () => {
    const misnamed = cells().filter(
      cell =>
        !/^@r10c\/implementation-[a-z0-9-]+-(react|next|http|mongo|redis|sql)$/.test(
          cell.name,
        ),
    );

    expect(misnamed.map(cell => cell.name)).toEqual([]);
  });
});

interface ShellManifest {
  readonly name: string;
  readonly tags: readonly string[];
}

const SHELL_KINDS = ['shell:base', 'shell:domain', 'shell:platform'];

/**
 * What is wrong with an Effect shell's tags. A shell is `shell:base` — the
 * fleet's shared composition, `scope:shared` — or the one shell of one slice,
 * `shell:domain` or `shell:platform`, scoped to exactly that slice. A slice
 * shell scoped `shared`, or to a name no slice declares, is a shell the scope
 * rule cannot keep to its own slice (ADR 0064).
 */
const effectShellProblems = (
  shells: readonly ShellManifest[],
  sliceNames: ReadonlySet<string>,
): string[] =>
  shells.flatMap(shell => {
    const kinds = shell.tags.filter(tag => SHELL_KINDS.includes(tag));
    const scopes = shell.tags
      .filter(tag => tag.startsWith('scope:'))
      .map(tag => tag.slice('scope:'.length));
    if (kinds.length !== 1)
      return [`${shell.name}: carries ${kinds.length} shell:* kinds`];
    if (kinds[0] === 'shell:base')
      return scopes.length === 1 && scopes[0] === 'shared'
        ? []
        : [`${shell.name}: shell:base must be scope:shared alone`];
    return scopes.length === 1 && sliceNames.has(scopes[0] ?? '')
      ? []
      : [`${shell.name}: must be scoped to exactly one declared slice`];
  });

describe('Effect shells are the base or one slice’s own', () => {
  const shells = (): ShellManifest[] => {
    const root = join(REPO_ROOT, 'packages', 'shells', 'effect');
    if (!existsSync(root)) return [];
    return readdirSync(root, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => join(root, entry.name, 'package.json'))
      .filter(manifest => existsSync(manifest))
      .map(manifest => {
        const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
        return { name: pkg.name as string, tags: pkg?.nx?.tags ?? [] };
      });
  };
  const sliceNames = new Set(SLICES.map(slice => slice.name));

  it('finds the shells it is meant to check', () => {
    expect(shells().length).toBeGreaterThanOrEqual(2);
  });

  it('tags every shell as the base, or as one declared slice’s shell', () => {
    expect(effectShellProblems(shells(), sliceNames)).toEqual([]);
  });

  it('rejects a mis-scoped shell, and accepts its legal twin', () => {
    const planted: ShellManifest[] = [
      { name: 'shared', tags: ['layer:shell', 'shell:domain', 'scope:shared'] },
      { name: 'ghost', tags: ['layer:shell', 'shell:domain', 'scope:ghost'] },
      {
        name: 'two',
        tags: ['layer:shell', 'shell:domain', 'scope:order', 'scope:stock'],
      },
      { name: 'kindless', tags: ['layer:shell', 'scope:order'] },
      { name: 'base', tags: ['layer:shell', 'shell:base', 'scope:order'] },
    ];
    const legal: ShellManifest[] = [
      { name: 'order', tags: ['layer:shell', 'shell:domain', 'scope:order'] },
      { name: 'base', tags: ['layer:shell', 'shell:base', 'scope:shared'] },
    ];

    expect(effectShellProblems(planted, sliceNames)).toHaveLength(
      planted.length,
    );
    expect(effectShellProblems(legal, sliceNames)).toEqual([]);
  });
});

interface DeploymentImports {
  readonly slice: string;
  readonly deployment: string;
  /** Every `@r10c/shells-effect-*` package its `src/` imports. */
  readonly shells: readonly string[];
}

/**
 * What is wrong with what each deployment mounts. An app only mounts
 * (ADR 0064), so its source imports exactly one slice shell — its own — beside
 * the base every shell builds on. A deployment importing two is composing
 * across slices in the app; one importing none composes for itself.
 */
const deploymentShellProblems = (
  deployments: readonly DeploymentImports[],
): string[] =>
  deployments.flatMap(({ slice, deployment, shells }) => {
    const mounted = [...new Set(shells)].filter(
      shell => shell !== '@r10c/shells-effect-service',
    );
    return mounted.length === 1 && mounted[0] === `@r10c/shells-effect-${slice}`
      ? []
      : [`${deployment}: mounts ${mounted.join(', ') || 'no shell'}`];
  });

describe('Each deployment mounts exactly its slice’s shell', () => {
  const sourcesOf = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
      entry.isDirectory()
        ? sourcesOf(join(dir, entry.name))
        : entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')
          ? [join(dir, entry.name)]
          : [],
    );
  const deployments = (): DeploymentImports[] =>
    SLICES.filter(slice => slice.status === 'active').flatMap(slice =>
      slice.deployments
        .map(deployment => join(REPO_ROOT, 'apps', deployment, 'src'))
        .filter(src => existsSync(src))
        .map(src => ({
          slice: slice.name,
          deployment: relative(REPO_ROOT, src),
          shells: sourcesOf(src).flatMap(file =>
            [
              ...readFileSync(file, 'utf8').matchAll(
                /from '(@r10c\/shells-effect-[a-z-]+)'/g,
              ),
            ].map(match => match[1] as string),
          ),
        })),
    );

  it('finds the deployments it is meant to check', () => {
    expect(deployments().length).toBeGreaterThanOrEqual(10);
  });

  it('mounts one shell per deployment, and it is the slice’s own', () => {
    expect(deploymentShellProblems(deployments())).toEqual([]);
  });

  it('rejects an app that mounts two shells or none, and accepts its twin', () => {
    expect(
      deploymentShellProblems([
        {
          slice: 'order',
          deployment: 'two',
          shells: ['@r10c/shells-effect-order', '@r10c/shells-effect-stock'],
        },
        { slice: 'order', deployment: 'none', shells: [] },
        {
          slice: 'order',
          deployment: 'other',
          shells: ['@r10c/shells-effect-stock'],
        },
      ]),
    ).toHaveLength(3);
    expect(
      deploymentShellProblems([
        {
          slice: 'order',
          deployment: 'twin',
          shells: [
            '@r10c/shells-effect-order',
            '@r10c/shells-effect-order',
            '@r10c/shells-effect-service',
          ],
        },
      ]),
    ).toEqual([]);
  });
});

describe('Fleet ports agree in every place they are written', () => {
  const freePorts = read('tools/free-ports.sh');
  const portsDoc = read('docs/_shared/ports.md');

  const allPorts = (): string[] => {
    const match = freePorts.match(/^ALL_PORTS=\(([^)]*)\)/m);
    if (!match) throw new Error('ALL_PORTS not found in tools/free-ports.sh');
    return match[1].trim().split(/\s+/);
  };

  /** Ports an app or service actually binds, read from where each one binds it. */
  const boundPorts = (): Map<string, string> => {
    const found = new Map<string, string>();
    const apps = join(REPO_ROOT, 'apps');

    for (const entry of readdirSync(apps, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.endsWith('-e2e')) continue;

      // A Next app binds through its dev command; a service through a constant.
      const pkgPath = join(apps, entry.name, 'package.json');
      if (existsSync(pkgPath)) {
        const dev = JSON.parse(readFileSync(pkgPath, 'utf8'))?.nx?.targets?.dev;
        const port = JSON.stringify(dev ?? {}).match(/next dev -p (\d+)/);
        if (port) found.set(port[1], entry.name);
      }

      for (const file of ['src/main.ts', 'src/index.ts']) {
        const full = join(apps, entry.name, file);
        if (!existsSync(full)) continue;
        const text = readFileSync(full, 'utf8');
        const port =
          text.match(/DEFAULT_PORT\s*=\s*(\d{4})/) ??
          text.match(/process\.env\.PORT\)\s*\|\|\s*(\d{4})/);
        if (port) found.set(port[1], entry.name);
      }
    }
    return found;
  };

  it('finds the ports it is meant to check', () => {
    expect(allPorts().length).toBeGreaterThanOrEqual(6);
    expect(boundPorts().size).toBeGreaterThanOrEqual(4);
  });

  it('frees every port something actually binds', () => {
    const listed = new Set(allPorts());
    const missing = [...boundPorts()]
      .filter(([port]) => !listed.has(port))
      .map(([port, app]) => `${port} (${app})`);

    expect(
      missing,
      'these ports are bound by an app but absent from ALL_PORTS in ' +
        `tools/free-ports.sh, so a stale listener survives a restart:\n  ${missing.join('\n  ')}`,
    ).toEqual([]);
  });

  it('documents every port it frees', () => {
    const missing = allPorts().filter(port => !portsDoc.includes(port));

    expect(
      missing,
      'these ports are in ALL_PORTS but the port table never mentions them:\n' +
        `  ${missing.join('\n  ')}`,
    ).toEqual([]);
  });

  it("gives every service's inspector its own port, and frees it", () => {
    const inspectPorts = new Set(
      (freePorts.match(/^INSPECT_PORTS=\(([^)]*)\)/m)?.[1] ?? '')
        .trim()
        .split(/\s+/),
    );
    const apps = join(REPO_ROOT, 'apps');
    const wrong: string[] = [];
    let checked = 0;

    for (const entry of readdirSync(apps, { withFileTypes: true })) {
      const pkgPath = join(apps, entry.name, 'package.json');
      if (!entry.isDirectory() || !existsSync(pkgPath)) continue;
      const targets =
        JSON.parse(readFileSync(pkgPath, 'utf8'))?.nx?.targets ?? {};
      if (targets.dev?.executor !== '@nx/js:node') continue;
      checked++;

      // The executor defaults every process to 9229, so two services in one
      // fleet collide unless each names a port: its service port + 6000.
      const freed: string = targets['free-ports']?.options?.command ?? '';
      const service = freed.match(/free-ports\.sh (\d{4})/)?.[1];
      const expected = service && String(Number(service) + 6000);
      const actual = String(targets.dev.options?.port ?? '9229');

      if (actual !== expected)
        wrong.push(`${entry.name}: port ${actual}, expected ${expected}`);
      else if (!freed.includes(` ${expected}`))
        wrong.push(`${entry.name}: free-ports skips ${expected}`);
      else if (!inspectPorts.has(expected))
        wrong.push(`${entry.name}: ${expected} not in INSPECT_PORTS`);
    }

    expect(checked).toBeGreaterThanOrEqual(4);
    expect(
      wrong,
      `inspector ports out of convention:\n  ${wrong.join('\n  ')}`,
    ).toEqual([]);
  });
});

/**
 * What is wrong with one service's runner ports (ADR 0066): each replica's
 * port must be its service port + 31000 + 1000 × the replica, freed by the
 * service's own `free-ports`, listed in `RUNNER_PORTS`, and in the port table.
 */
const runnerPortProblems = (input: {
  readonly app: string;
  readonly servicePort: number;
  readonly replicas: readonly number[];
  readonly runnerPorts: ReadonlySet<string>;
  readonly freed: string;
  readonly portsDoc: string;
}): string[] =>
  input.replicas.flatMap(replica => {
    const port = String(input.servicePort + 31_000 + 1_000 * replica);
    const where = `${input.app} replica ${String(replica)} (${port})`;
    if (!input.runnerPorts.has(port)) return [`${where}: not in RUNNER_PORTS`];
    if (!input.freed.includes(` ${port}`))
      return [`${where}: free-ports skips it`];
    if (!input.portsDoc.includes(`\`${port}\``))
      return [`${where}: the port table never names it`];
    return [];
  });

describe('Every flow-engine runner has the port its formula names', () => {
  const freePorts = read('tools/free-ports.sh');
  const portsDoc = read('docs/_shared/ports.md');
  const runnerPorts = new Set(
    (freePorts.match(/^RUNNER_PORTS=\(([^)]*)\)/m)?.[1] ?? '')
      .trim()
      .split(/\s+/),
  );

  /**
   * Every app that runs the engine: replica 0 is the service itself, and each
   * further replica is a dev target that starts `dist/runner.js` with its own
   * `WORKFLOW_REPLICA`.
   */
  const runners = () => {
    const apps = join(REPO_ROOT, 'apps');
    return readdirSync(apps, { withFileTypes: true }).flatMap(entry => {
      if (!existsSync(join(apps, entry.name, 'src/runner.ts'))) return [];
      const targets =
        JSON.parse(readFileSync(join(apps, entry.name, 'package.json'), 'utf8'))
          ?.nx?.targets ?? {};
      const index = readFileSync(
        join(apps, entry.name, 'src/index.ts'),
        'utf8',
      );
      const servicePort = Number(
        index.match(/DEFAULT_PORT\s*=\s*(\d{4})/)?.[1],
      );
      const replicas = [
        0,
        ...Object.values(targets).flatMap(target => {
          const options = (target as { options?: Record<string, unknown> })
            .options;
          return String(options?.['command'] ?? '').includes('dist/runner.js')
            ? [
                Number(
                  (options?.['env'] as Record<string, string>)?.[
                    'WORKFLOW_REPLICA'
                  ],
                ),
              ]
            : [];
        }),
      ];
      return [
        {
          app: entry.name,
          servicePort,
          replicas,
          freed: String(targets['free-ports']?.options?.command ?? ''),
        },
      ];
    });
  };

  it('finds the runners it is meant to check', () => {
    expect(runners().map(({ app, replicas }) => [app, replicas])).toEqual([
      ['transaction-service', [0, 1]],
    ]);
  });

  it('frees, lists and documents each runner at its formula port', () => {
    const problems = runners().flatMap(runner =>
      runnerPortProblems({ ...runner, runnerPorts, portsDoc }),
    );

    expect(
      problems,
      `runner ports out of convention:\n  ${problems.join('\n  ')}`,
    ).toEqual([]);
  });

  /** The plant: a runner moved off its formula must fail the check above. */
  it('fails a runner whose port is not the formula', () => {
    const [runner] = runners();
    if (runner === undefined) throw new Error('no runner to plant against');

    expect(
      runnerPortProblems({
        ...runner,
        servicePort: runner.servicePort + 1,
        runnerPorts,
        portsDoc,
      }),
    ).toEqual([
      `${runner.app} replica 0 (34104): not in RUNNER_PORTS`,
      `${runner.app} replica 1 (35104): not in RUNNER_PORTS`,
    ]);
    expect(
      runnerPortProblems({
        ...runner,
        freed: 'bash tools/free-ports.sh 3103 9103',
        runnerPorts,
        portsDoc,
      }),
    ).toEqual([
      `${runner.app} replica 0 (34103): free-ports skips it`,
      `${runner.app} replica 1 (35103): free-ports skips it`,
    ]);
    expect(
      runnerPortProblems({ ...runner, runnerPorts, portsDoc: '' }),
    ).toHaveLength(2);
  });
});

describe('The Zitadel core and its hosted login are one tag', () => {
  // Nothing substitutes a version into these manifests — `apply.sh` is a plain
  // `kubectl apply -k` and no kustomization declares an `images:` transformer —
  // so the two tags are two literals, and this is what makes them one fact. A
  // third copy in `lib.sh` would be one more thing to drift; the constraint to
  // encode is "these two agree", not "someone should remember".
  const CORE = 'infra/local/zitadel/deployment.yaml';
  const LOGIN = 'infra/local/zitadel-login/deployment.yaml';

  /** Every tag a manifest pins for one image, in file order. */
  const tagsFor = (file: string, image: string): string[] => {
    const pattern = new RegExp(`image:\\s*${image}:(\\S+)`, 'g');
    return [...read(file).matchAll(pattern)].map(match => match[1]);
  };

  const coreTags = () => tagsFor(CORE, 'ghcr\\.io/zitadel/zitadel');
  const loginTags = () => tagsFor(LOGIN, 'ghcr\\.io/zitadel/zitadel-login');

  it('finds the images it is meant to check', () => {
    // One apiece. The core manifest also runs `busybox` init containers, which
    // the image pattern deliberately does not match.
    expect(coreTags()).toHaveLength(1);
    expect(loginTags()).toHaveLength(1);
  });

  it('pins the login to the core tag', () => {
    expect(
      loginTags()[0],
      `the hosted login is pinned to ${loginTags()[0]} while the core runs ` +
        `${coreTags()[0]}. The login is a client of the core's session API, ` +
        'not an independent product, so a skew fails somewhere inside the ' +
        'sign-in flow rather than at startup — no probe sees it. Bump both ' +
        `${CORE} and ${LOGIN} together (login v4.14.0 also reopens ` +
        'zitadel/zitadel#12125).',
    ).toBe(coreTags()[0]);
  });
});

describe('The dashboard charts the metrics the fleet declares', () => {
  // Nothing connects a Grafana panel to the code that emits its series: the
  // dashboard is a JSON blob of PromQL strings, and a metric rename leaves the
  // panel rendering an empty graph forever — which reads as "idle", not
  // "broken". This is the only thing that looks, and it looks both ways.
  const DASHBOARD = 'infra/local/otel-lgtm/dashboards/r10c-bus-outbox.json';
  const PROVIDER = 'infra/local/otel-lgtm/dashboards/r10c-dashboards.yaml';
  const DEPLOYMENT = 'infra/local/otel-lgtm/deployment.yaml';
  const SOURCES = [
    // The two framework modules are read from the release installed here, which
    // is the code the fleet actually runs; the built JS keeps each declaration
    // as `export const … = Metric.counter('…')`, which is all this reads.
    join(
      relative(REPO_ROOT, installedEntifixDist('amqp')),
      'adapters',
      'bus-metrics.js',
    ),
    // The outbox gauges left marketplace-admin-service when a second and third
    // slice grew an outbox (#152), and left the Mongo relay for the relay every
    // store shares in entifix 0.12.0: an Effect metric is keyed on its
    // *description*, and three hand-maintained copies are three series the
    // moment one wording drifts.
    join(
      relative(REPO_ROOT, installedEntifixDist('transactions')),
      'engine',
      'outbox-metrics.js',
    ),
    // Each participant's breaker and bulkhead (ADR 0067), the retry budget
    // every fleet service draws its in-process retries from (ADR 0064), and
    // the states the flow engine journals (ADR 0066) — declared beside their
    // ports, so read from there.
    ...['circuit-breaker', 'bulkhead', 'retry-budget'].map(port =>
      join(
        relative(REPO_ROOT, installedEntifixDist('transactions')),
        'ports',
        `${port}.js`,
      ),
    ),
    join(
      relative(REPO_ROOT, installedEntifixDist('workflow')),
      'status',
      'flow-status-store.js',
    ),
  ];

  /** The provisioning directory whose contents a mount must never replace. */
  const PROVISIONING = '/otel-lgtm/grafana/conf/provisioning';

  // ⚠️ Anchored on `export const`, not on `Metric.` alone: bus-metrics.ts's own
  // doc comment writes `Metric.counter('bus_events_published_total')` out again,
  // so a bare matcher finds five counters where the module declares four. The
  // optional type group is for `outboxOldestPendingAge`, which carries a
  // `: Metric.Gauge<number>` annotation between the name and the `=`.
  const DECLARATION =
    /export const \w+(?::[^=]+)?\s*=\s*Metric\.(counter|gauge)\(\s*'([a-z0-9_]+)'/g;
  // Effect 4 sets a unit as an attribute, `Metric.withAttributes({ unit: 's' })`;
  // the Effect 3 spelling was `Metric.tagged('unit', 's')`.
  const UNIT_TAG =
    /Metric\.withAttributes\(\s*\{\s*unit:\s*'([a-z]+)'\s*\}\s*\)/;

  /** The suffix the OTLP→Prometheus exporter appends, by declared unit. */
  const UNIT_SUFFIX: Record<string, string> = {
    s: '_seconds',
    ms: '_milliseconds',
  };

  /**
   * The name a declared metric actually reaches Prometheus under.
   *
   * A dimensionless Effect gauge gains `_ratio` — OTel's convention for unit
   * `1` — and a gauge tagged with a real unit gains that unit's suffix instead.
   * Counters pass through untouched. Getting this wrong is silent at both ends.
   */
  const prometheusName = (
    kind: string,
    name: string,
    block: string,
  ): string => {
    if (kind === 'counter') return name;
    const unit = block.match(UNIT_TAG)?.[1];
    if (unit === undefined) return `${name}_ratio`;
    const suffix = UNIT_SUFFIX[unit];
    if (suffix === undefined) {
      throw new Error(
        `${name} is tagged unit '${unit}', which this check has no suffix for. ` +
          'Add it to UNIT_SUFFIX — guessing would assert the wrong series name.',
      );
    }
    return `${name}${suffix}`;
  };

  /** Every metric the two declaring modules export, as Prometheus names. */
  const declared = (): string[] =>
    SOURCES.flatMap(source => {
      const text = read(source);
      // Unit is attributed per declaration, not per file: the block runs from
      // the end of this declaration to the next `export const`, which keeps
      // `Metric.withAttributes(metric, { database })` in a helper further down
      // from being read as the gauge's own unit. Slicing from `match.index`
      // instead would start the block *at* `export const` and split it to
      // nothing, silently making every gauge read as dimensionless.
      return [...text.matchAll(DECLARATION)].map(match => {
        const block = text
          .slice(match.index + match[0].length)
          .split('export const')[0];
        return prometheusName(match[1], match[2], block);
      });
    });

  interface Panel {
    readonly panels?: readonly Panel[];
    readonly targets?: readonly { readonly expr?: string }[];
  }

  const dashboard = () =>
    JSON.parse(read(DASHBOARD)) as {
      panels: readonly Panel[];
      templating: { list: readonly { query?: { query?: string } }[] };
    };

  /** Every panel, rows flattened — a collapsed row still holds its queries. */
  const flatten = (panels: readonly Panel[]): readonly Panel[] =>
    panels.flatMap(panel => [panel, ...flatten(panel.panels ?? [])]);

  // A metric selector is an identifier immediately followed by `{` or `[`.
  // Every expr here carries `{service_name=~…}`, so none is missed; `vector(0)`
  // is followed by `(`, and a label name inside braces by `=`, so neither
  // matches. `by (database)` is a keyword followed by `(` — also not matched.
  const SELECTOR = /([a-z_][a-z0-9_]*)\s*[{[]/g;

  /** Every metric name the dashboard queries, panels and variables alike. */
  const queried = (): string[] => {
    const board = dashboard();
    const exprs = [
      ...flatten(board.panels).flatMap(panel =>
        (panel.targets ?? []).map(target => target.expr ?? ''),
      ),
      ...board.templating.list.map(variable => variable.query?.query ?? ''),
    ];
    return exprs.flatMap(expr => [
      ...[...expr.matchAll(SELECTOR)].map(match => match[1]),
      // `label_values(<metric>, <label>)` names its metric without a selector.
      ...[...expr.matchAll(/label_values\(\s*([a-z_][a-z0-9_]*)\s*,/g)].map(
        match => match[1],
      ),
    ]);
  };

  it('finds the metrics it is meant to check', () => {
    // Seventeen: five bus counters and the paused-consumer gauge, three outbox
    // gauges, the breaker's gauge and two counters, the bulkhead's gauge, the
    // retry budget's three counters, and the flow engine's state counter.
    // Pinned as a count rather than a Set size,
    // so the doc-comment over-match the DECLARATION regex is written to avoid
    // cannot hide behind dedup.
    expect(declared()).toHaveLength(17);
    expect(new Set(queried()).size).toBeGreaterThanOrEqual(8);
  });

  it('queries only metrics the fleet declares', () => {
    const known = new Set(declared());
    const unknown = [...new Set(queried())].filter(name => !known.has(name));

    expect(
      unknown,
      `${DASHBOARD} queries ${unknown.join(', ')}, which nothing declares. ` +
        'The declared name is not the Prometheus name: a dimensionless gauge ' +
        "gains `_ratio`, a gauge tagged `unit: 's'` gains `_seconds`, and " +
        'counters pass through. A panel naming the declared form renders an ' +
        'empty graph forever, which reads as "idle" rather than "broken".',
    ).toEqual([]);
  });

  it('charts every metric the fleet declares', () => {
    const charted = new Set(queried());
    const uncharted = declared().filter(name => !charted.has(name));

    expect(
      uncharted,
      `${uncharted.join(', ')} is emitted and appears on no panel. A metric ` +
        'nothing charts is the gap #206 closed — add a panel to ' +
        `${DASHBOARD}, or stop emitting it.`,
    ).toEqual([]);
  });

  it('points every panel at the provisioned datasource uid', () => {
    const text = read(DASHBOARD);
    // Scoped to the uid *inside* a `datasource` object: the dashboard's own
    // top-level `"uid": "r10c-bus-outbox"` is not a datasource reference.
    const uids = [
      ...text.matchAll(/"datasource":\s*\{[^}]*"uid":\s*"([^"]+)"/g),
    ].map(match => match[1]);

    expect(uids.length).toBeGreaterThan(10);
    expect(
      uids.filter(uid => uid !== 'prometheus' && uid !== '-- Grafana --'),
      'every panel must name the `prometheus` uid the otel-lgtm image ' +
        'provisions. Grafana\'s "Export for sharing externally" rewrites it to ' +
        '${DS_PROMETHEUS} and adds `__inputs`, which the *file* provisioner ' +
        'does not resolve — the dashboard then provisions cleanly and every ' +
        'panel reports a missing datasource.',
    ).toEqual([]);
    expect(text).not.toContain('__inputs');
    expect(text).not.toContain('${DS_');
  });

  it('aims the provider at the path the deployment mounts', () => {
    const path = read(PROVIDER).match(/^\s*path:\s*(\S+)/m)?.[1];
    const mounts = [...read(DEPLOYMENT).matchAll(/mountPath:\s*(\S+)/g)].map(
      match => match[1],
    );

    expect(path).toBeDefined();
    expect(mounts).toHaveLength(2);
    expect(
      mounts,
      `${PROVIDER} provisions from ${path}, which ${DEPLOYMENT} does not ` +
        'mount. A provider aimed at an empty path provisions zero dashboards ' +
        'and says so only at debug level.',
    ).toContain(path);
  });

  it('grafts the provider beside the image files rather than over them', () => {
    const mounts = [...read(DEPLOYMENT).matchAll(/mountPath:\s*(\S+)/g)].map(
      match => match[1],
    );

    // The image provisions its own dashboards from the first directory and the
    // `prometheus`/`tempo`/`loki`/`pyroscope` uids from the second. A ConfigMap
    // volume mounted at a directory REPLACES it, so either of these as a
    // mountPath deletes what the image ships — invisibly, in a manifest diff
    // that looks like it only adds.
    for (const directory of [
      `${PROVISIONING}/dashboards`,
      `${PROVISIONING}/datasources`,
    ]) {
      expect(
        mounts,
        `mounting a ConfigMap at ${directory} replaces that directory and ` +
          'deletes the files the grafana/otel-lgtm image ships there. Mount ' +
          'the single file with `subPath` instead.',
      ).not.toContain(directory);
    }

    const grafted = mounts.find(mount => mount.startsWith(PROVISIONING));
    expect(grafted).toBeDefined();
    expect(
      read(DEPLOYMENT).match(/subPath:\s*(\S+)/g),
      `${grafted} reaches into the image's provisioning tree, so it must be a ` +
        '`subPath` mount of one file.',
    ).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ edge */

type Tree = { readonly [key: string]: Yaml };
const asTree = (value: Yaml | undefined): Tree =>
  (value ?? {}) as unknown as Tree;
const asList = (value: Yaml | undefined): readonly Yaml[] =>
  (value ?? []) as readonly Yaml[];
const clone = <T>(value: T): T => structuredClone(value);
const seconds = (value: Yaml | undefined): number =>
  Number(String(value).replace(/s$/, ''));

/** Every value under a key named `key`, anywhere in a tree. */
const valuesOf = (tree: Yaml, key: string): Yaml[] => {
  if (typeof tree !== 'object') return [];
  if (Array.isArray(tree))
    return (tree as readonly Yaml[]).flatMap(item => valuesOf(item, key));
  return Object.entries(tree as Tree).flatMap(([name, value]) => [
    ...(name === key ? [value] : []),
    ...valuesOf(value, key),
  ]);
};

/**
 * What is wrong with the local edge (ADR 0072): every listener is a `300N`
 * origin whose Next upstream is the origin + 200, every upstream is a port
 * `free-ports` knows, every origin routes the realtime prefix and its stream to
 * the realtime port, the stream never times out, every idle timeout is over
 * twice the push heartbeat, and no access log writes a query string.
 */
const edgeProblems = (input: {
  readonly config: Yaml;
  readonly allPorts: ReadonlySet<string>;
  readonly heartbeat: number;
}): string[] => {
  const problems: string[] = [];
  const statics = asTree(asTree(input.config)['static_resources']);

  const clusterPort = new Map<string, number>();
  for (const cluster of asList(statics['clusters'])) {
    const { name } = asTree(cluster);
    const [port] = valuesOf(cluster, 'port_value');
    clusterPort.set(String(name), Number(port));
    if (!input.allPorts.has(String(port)))
      problems.push(
        `cluster ${String(name)}: ${String(port)} not in ALL_PORTS`,
      );
  }

  for (const listener of asList(statics['listeners'])) {
    const [origin] = valuesOf(asTree(listener)['address'] ?? {}, 'port_value');
    const where = `listener ${String(origin)}`;
    if (!/^300\d$/.test(String(origin)))
      problems.push(`${where}: not a 300N origin`);

    const routes = valuesOf(listener, 'routes').flatMap(asList).map(asTree);
    const target = (match: Tree) =>
      routes.find(
        route => JSON.stringify(route['match']) === JSON.stringify(match),
      );
    const portOf = (route: Tree | undefined) =>
      clusterPort.get(String(asTree(route?.['route'])['cluster']));

    const next = target({ prefix: '/' });
    if (portOf(next) !== Number(origin) + UPSTREAM_OFFSET)
      problems.push(
        `${where}: / goes to ${String(portOf(next))}, not ${String(Number(origin) + UPSTREAM_OFFSET)}`,
      );

    const prefix = target({ path_separated_prefix: REALTIME.prefix });
    if (portOf(prefix) !== REALTIME.port)
      problems.push(
        `${where}: ${REALTIME.prefix} does not reach ${String(REALTIME.port)}`,
      );

    const stream = target({ path: REALTIME.stream });
    if (portOf(stream) !== REALTIME.port)
      problems.push(
        `${where}: ${REALTIME.stream} does not reach ${String(REALTIME.port)}`,
      );
    else if (asTree(stream?.['route'])['timeout'] !== '0s')
      problems.push(`${where}: the stream route times out`);

    for (const format of valuesOf(listener, 'inline_string'))
      if (
        !String(format).includes('%REQ_WITHOUT_QUERY(:PATH)%') ||
        String(format).includes('%REQ(:PATH)%')
      )
        problems.push(`${where}: an access log writes the query string`);
  }

  for (const key of ['idle_timeout', 'stream_idle_timeout'])
    for (const value of valuesOf(input.config, key))
      if (!(seconds(value) > 2 * input.heartbeat))
        problems.push(
          `${key} ${String(value)} is not over twice the ${String(input.heartbeat)}s heartbeat`,
        );

  return problems;
};

/** The cluster rendering of the same rules, over the Envoy Gateway resources. */
const gatewayProblems = (input: {
  readonly manifests: Readonly<Record<string, readonly Yaml[]>>;
  readonly heartbeat: number;
}): string[] => {
  const problems: string[] = [];
  const documents = Object.values(input.manifests).flat().map(asTree);
  const kind = (name: string) => documents.filter(doc => doc['kind'] === name);

  const listeners = kind('Gateway').flatMap(gateway =>
    asList(asTree(gateway['spec'])['listeners']).map(asTree),
  );
  for (const listener of listeners)
    if (!/^300\d$/.test(String(listener['port'])))
      problems.push(
        `gateway listener ${String(listener['port'])}: not a 300N origin`,
      );

  const routes = kind('HTTPRoute');
  if (routes.length !== listeners.length)
    problems.push(
      `${String(listeners.length)} listeners but ${String(routes.length)} HTTPRoutes`,
    );

  for (const route of routes) {
    const name = String(asTree(route['metadata'])['name']);
    const rules = asList(asTree(route['spec'])['rules']).map(asTree);
    const rule = (type: string, value: string) =>
      rules.find(candidate =>
        asList(candidate['matches']).some(match => {
          const path = asTree(asTree(match)['path']);
          return path['type'] === type && path['value'] === value;
        }),
      );
    const reachesRealtime = (candidate: Tree | undefined) =>
      asList(candidate?.['backendRefs']).some(ref => {
        const tree = asTree(ref);
        return tree['name'] === REALTIME.app && tree['port'] === REALTIME.port;
      });

    if (!reachesRealtime(rule('PathPrefix', REALTIME.prefix)))
      problems.push(
        `HTTPRoute ${name}: ${REALTIME.prefix} does not reach ${REALTIME.app}:${String(REALTIME.port)}`,
      );
    const stream = rule('Exact', REALTIME.stream);
    if (!reachesRealtime(stream))
      problems.push(
        `HTTPRoute ${name}: ${REALTIME.stream} does not reach ${REALTIME.app}:${String(REALTIME.port)}`,
      );
    else if (asTree(stream?.['timeouts'])['request'] !== '0s')
      problems.push(`HTTPRoute ${name}: the stream rule times out`);
  }

  for (const key of ['idleTimeout', 'connectionIdleTimeout'])
    for (const value of valuesOf(documents as unknown as Yaml, key))
      if (!(seconds(value) > 2 * input.heartbeat))
        problems.push(
          `${key} ${String(value)} is not over twice the ${String(input.heartbeat)}s heartbeat`,
        );

  return problems;
};

describe('The edge owns the origins, and every hop holds a quiet stream', () => {
  const freePorts = read('tools/free-ports.sh');
  const allPorts = new Set(
    (freePorts.match(/^ALL_PORTS=\(([^)]*)\)/m)?.[1] ?? '').trim().split(/\s+/),
  );
  const config = envoyConfig();
  const manifests = gatewayManifests();

  it('finds the listeners, clusters and routes it is meant to check', () => {
    const statics = asTree(asTree(config)['static_resources']);
    expect(asList(statics['listeners'])).toHaveLength(2);
    expect(asList(statics['clusters'])).toHaveLength(3);
    expect(Object.values(manifests).flat()).toHaveLength(6);
  });

  it('mirrors the push heartbeat the installed release sends', () => {
    const sse = readFileSync(
      join(installedEntifixDist('service-shell'), 'push', 'sse.js'),
      'utf8',
    );
    const installed = sse.match(
      /PUSH_HEARTBEAT\s*=\s*Duration\.seconds\((\d+)\)/,
    )?.[1];
    expect(
      installed,
      'PUSH_HEARTBEAT not found in @entifix/service-shell',
    ).toBeDefined();
    expect(HEARTBEAT_S).toBe(Number(installed));
  });

  it('routes every origin by the convention, locally and in the cluster', () => {
    const problems = [
      ...edgeProblems({ config, allPorts, heartbeat: HEARTBEAT_S }),
      ...gatewayProblems({ manifests, heartbeat: HEARTBEAT_S }),
    ];
    expect(
      problems,
      `the edge is out of convention:\n  ${problems.join('\n  ')}`,
    ).toEqual([]);
  });

  it('runs an Envoy image pinned by digest', () => {
    const image = read('tools/edge/serve.sh').match(/^IMAGE='([^']+)'/m)?.[1];
    expect(image, 'IMAGE not found in tools/edge/serve.sh').toBeDefined();
    expect(image).toMatch(/^envoyproxy\/envoy:v[\d.]+@sha256:[0-9a-f]{64}$/);
  });

  it('keeps every rendered file equal to its generator', async () => {
    const files = await renderEdge(REPO_ROOT);
    expect(Object.keys(files)).toContain(ENVOY_FILE);
    const stale = Object.entries(files)
      .filter(
        ([path, text]) =>
          !existsSync(join(REPO_ROOT, path)) || read(path) !== text,
      )
      .map(([path]) => path);
    expect(
      stale,
      `stale, or edited by hand — run \`pnpm nx run @r10c/edge:generate\`:\n  ${stale.join('\n  ')}`,
    ).toEqual([]);
  });

  /** The plants: each rule above must fail the config that breaks it. */
  describe('fails an edge that breaks a rule', () => {
    const statics = (tree: Yaml) =>
      asTree(asTree(tree)['static_resources']) as Record<string, Yaml>;
    const listenerOf = (tree: Yaml, index: number) =>
      asList(statics(tree)['listeners'])[index] as Yaml;
    const routesOf = (tree: Yaml) =>
      valuesOf(listenerOf(tree, 1), 'routes').flatMap(asList) as Record<
        string,
        Yaml
      >[];
    const check = (tree: Yaml, ports: ReadonlySet<string> = allPorts) =>
      edgeProblems({ config: tree, allPorts: ports, heartbeat: HEARTBEAT_S });

    it('an upstream that is not the origin + 200', () => {
      const planted = clone(config);
      const clusters = asList(statics(planted)['clusters']) as Record<
        string,
        Yaml
      >[];
      const [next] = clusters;
      const socket = valuesOf(next, 'socket_address')[0] as Record<
        string,
        Yaml
      >;
      socket['port_value'] = 3300;
      expect(check(planted, new Set([...allPorts, '3300']))).toEqual([
        'listener 3000: / goes to 3300, not 3200',
      ]);
    });

    it('an upstream free-ports does not know', () => {
      const ports = new Set([...allPorts].filter(port => port !== '3191'));
      expect(check(config, ports)).toEqual([
        'cluster realtime: 3191 not in ALL_PORTS',
      ]);
    });

    it('a listener that is not a 300N origin', () => {
      const planted = clone(config);
      const socket = valuesOf(
        asTree(listenerOf(planted, 0))['address'] ?? {},
        'socket_address',
      )[0] as Record<string, Yaml>;
      socket['port_value'] = 8080;
      expect(check(planted)).toEqual(
        expect.arrayContaining(['listener 8080: not a 300N origin']),
      );
    });

    it('an origin that does not route the realtime prefix', () => {
      const planted = clone(config);
      const realtime = routesOf(planted).find(
        route => route['name'] === 'realtime',
      );
      if (!realtime) throw new Error('no realtime route to plant against');
      realtime['route'] = { cluster: 'next_3201' };
      expect(check(planted)).toEqual([
        'listener 3001: /api/realtime does not reach 3191',
      ]);
    });

    it('a stream route with a timeout', () => {
      const planted = clone(config);
      const stream = routesOf(planted).find(
        route => route['name'] === 'realtime-stream',
      );
      if (!stream) throw new Error('no stream route to plant against');
      (stream['route'] as Record<string, Yaml>)['timeout'] = '15s';
      expect(check(planted)).toEqual([
        'listener 3001: the stream route times out',
      ]);
    });

    it('an idle timeout under twice the heartbeat', () => {
      const planted = clone(config);
      const stream = routesOf(planted).find(
        route => route['name'] === 'realtime-stream',
      );
      if (!stream) throw new Error('no stream route to plant against');
      (stream['route'] as Record<string, Yaml>)['idle_timeout'] = '30s';
      expect(check(planted)).toEqual([
        'idle_timeout 30s is not over twice the 15s heartbeat',
      ]);
    });

    it('an access log that writes the query string', () => {
      const planted = clone(config);
      const source = valuesOf(
        listenerOf(planted, 0),
        'text_format_source',
      )[0] as Record<string, Yaml>;
      source['inline_string'] = '%REQ(:PATH)%\n';
      expect(check(planted)).toEqual([
        'listener 3000: an access log writes the query string',
      ]);
    });

    it('a cluster stream rule with a timeout, or a route that skips realtime', () => {
      const planted = clone(manifests) as Record<
        string,
        Record<string, Yaml>[]
      >;
      const [route] = planted['httproutes.yaml'] ?? [];
      const rules = asList(asTree(route?.['spec'])['rules']) as Record<
        string,
        Yaml
      >[];
      const [stream, prefix] = rules;
      if (!stream || !prefix) throw new Error('no rules to plant against');
      stream['timeouts'] = { request: '30s' };
      prefix['backendRefs'] = [{ name: 'marketplace-app', port: 3200 }];
      expect(
        gatewayProblems({ manifests: planted, heartbeat: HEARTBEAT_S }),
      ).toEqual([
        'HTTPRoute marketplace-app: /api/realtime does not reach realtime-service:3191',
        'HTTPRoute marketplace-app: the stream rule times out',
      ]);
    });
  });
});

/**
 * The component-audit skill states only rules a check enforces (#535, ADR
 * 0046): every bullet links a file that exists — the spec, script or workflow
 * that fails the build — or names an Nx target, `pnpm nx run <project>:<target>`,
 * that the project really has. A bullet with neither is a convention that is
 * only stated, and the skill is where it would quietly go stale.
 */
describe('The component-audit skill cites only checks that exist', () => {
  const SKILL = '.claude/skills/component-audit/SKILL.md';
  const TARGET = /`pnpm nx run (@[\w.-]+\/[\w.-]+):([\w:.-]+)`/g;

  /** Each list item, its continuation lines folded in. */
  const bullets = (text: string): string[] =>
    text
      .replace(/^---\n[\s\S]*?\n---\n/, '')
      .split('\n')
      .reduce<string[]>((items, line) => {
        if (line.startsWith('- ')) return [...items, line];
        if (items.length > 0 && /^ {2}\S/.test(line)) {
          items[items.length - 1] += ` ${line.trim()}`;
          return items;
        }
        if (!line.startsWith('  ')) items.push('');
        return items;
      }, [])
      .filter(item => item.startsWith('- '));

  const targets = new Map<string, readonly string[]>();
  const targetsOf = (project: string): readonly string[] => {
    const known = targets.get(project);
    if (known !== undefined) return known;
    let names: string[] = [];
    try {
      names = Object.keys(
        (
          JSON.parse(
            execFileSync('pnpm', ['nx', 'show', 'project', project, '--json'], {
              cwd: REPO_ROOT,
              encoding: 'utf8',
            }),
          ) as { targets: Record<string, unknown> }
        ).targets,
      );
    } catch {
      // An unknown project names no target.
    }
    targets.set(project, names);
    return names;
  };

  /** What in one bullet proves it, or why nothing does. */
  const evidence = (bullet: string) => {
    const files = localLinks(bullet).filter(({ target }) =>
      existsSync(resolve(join(REPO_ROOT, dirname(SKILL)), target)),
    );
    const runs = [...bullet.matchAll(TARGET)].filter(([, project, target]) =>
      targetsOf(project as string).includes(target as string),
    );
    return files.length + runs.length;
  };

  it('is committed, so the rule reaches everyone who works here', () => {
    expect(
      execFileSync('git', ['ls-files', SKILL], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      }).trim(),
    ).toBe(SKILL);
  });

  it('finds the bullets it is meant to check', () => {
    expect(bullets(read(SKILL)).length).toBeGreaterThanOrEqual(10);
  });

  it('links a check from every bullet', () => {
    expect(
      bullets(read(SKILL)).filter(bullet => evidence(bullet) === 0),
    ).toEqual([]);
  }, 120_000);

  it('fails a bullet that only states, or cites what does not exist', () => {
    expect(evidence('- Prefer accessible components.')).toBe(0);
    expect(evidence('- Gated by [a spec](../../../no/such.spec.ts).')).toBe(0);
    expect(
      evidence(
        '- Run `pnpm nx run @r10c/storefront-storybook:no-such-target`.',
      ),
    ).toBe(0);
    expect(
      evidence('- Run `pnpm nx run @r10c/storefront-storybook:test-a11y`.'),
    ).toBe(1);
  }, 60_000);
});
