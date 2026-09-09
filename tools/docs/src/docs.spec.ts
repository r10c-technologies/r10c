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
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { declaredEntityClasses, declaredEntityDomains } from '@r10c/slices';
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
    // 9229 is the Node inspector, not a fleet port; it has nothing to document.
    const missing = allPorts()
      .filter(port => port !== '9229')
      .filter(port => !portsDoc.includes(port));

    expect(
      missing,
      'these ports are in ALL_PORTS but the port table never mentions them:\n' +
        `  ${missing.join('\n  ')}`,
    ).toEqual([]);
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
    'packages/entifix/ts/amqp-client/src/adapters/bus-metrics.ts',
    'apps/marketplace-admin-service/src/observability/metrics.ts',
    // `transactions_by_state` left with the `saga` store's owner when the
    // `transaction` slice took `:3103` (#229). A module missing from this list
    // is not a loud failure — the dashboard check would simply stop knowing the
    // metric is declared and call every panel querying it undeclared.
    'apps/transaction-service/src/observability/metrics.ts',
  ];

  /** The provisioning directory whose contents a mount must never replace. */
  const PROVISIONING = '/otel-lgtm/grafana/conf/provisioning';

  // ⚠️ Anchored on `export const`, not on `Metric.` alone: bus-metrics.ts's own
  // doc comment writes `Metric.counter('bus_events_published_total')` out again,
  // so a bare matcher finds five counters where the module declares four. The
  // optional type group is for `outboxOldestPendingAge`, which carries a
  // `: Metric.Metric.Gauge<number>` annotation between the name and the `=`.
  const DECLARATION =
    /export const \w+(?::[^=]+)?\s*=\s*Metric\.(counter|gauge)\(\s*'([a-z0-9_]+)'/g;
  const UNIT_TAG = /Metric\.tagged\(\s*'unit',\s*'([a-z]+)'\s*\)/;

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
      // `Metric.tagged(metric, 'database', database)` in a helper further down
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
    // Eight: four bus counters, three outbox gauges, one transaction gauge.
    // Pinned as a count rather than a Set size, so the doc-comment over-match
    // the DECLARATION regex is written to avoid cannot hide behind dedup.
    expect(declared()).toHaveLength(8);
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
