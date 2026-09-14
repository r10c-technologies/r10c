import { describe, expect, it } from 'vitest';

import {
  declaresOptionalPeer,
  hasManifest,
  packageDirs,
  readManifest,
  tierTagCount,
  tierTagOf,
} from './manifests.js';
import {
  OPTIONAL_CAPABILITIES,
  PACKAGES,
  SCANNED_ROOTS,
  TIERS,
} from './registry.js';

const byName = new Map(PACKAGES.map(pkg => [pkg.name, pkg]));
const label = (tier: number) => `T${tier} ${TIERS[tier as 0]}`;

describe('ADR 0059 — the tier register is complete', () => {
  // Same guard as every other register in this repo: a scan that silently
  // stops matching would make every assertion below pass while checking
  // nothing. Pin the count so that failure is loud.
  it('finds the packages it is meant to check', () => {
    expect(PACKAGES.length).toBeGreaterThanOrEqual(23);
    expect(SCANNED_ROOTS.flatMap(packageDirs).length).toBeGreaterThanOrEqual(
      19,
    );
  });

  it('declares a directory that exists, holding the package it names', () => {
    for (const pkg of PACKAGES) {
      expect(
        hasManifest(pkg.dir),
        `the register puts '${pkg.name}' at ${pkg.dir}, and there is no ` +
          'package.json there — the entry is stale, or the package moved ' +
          'without it',
      ).toBe(true);

      expect(
        readManifest(pkg.dir).name,
        `${pkg.dir}/package.json does not call itself '${pkg.name}'`,
      ).toBe(pkg.name);
    }
  });

  it('registers every package that ships with entifix', () => {
    const unregistered = SCANNED_ROOTS.flatMap(packageDirs)
      .filter(dir => !PACKAGES.some(pkg => pkg.dir === dir))
      .map(dir => `${dir} (${readManifest(dir).name ?? 'unnamed'})`);

    expect(
      unregistered,
      'these packages live under an entifix root and carry no tier, so ' +
        "nothing constrains what they may drag into an adopter's tree:\n  " +
        unregistered.join('\n  '),
    ).toEqual([]);
  });
});

describe('Every package carries its tier', () => {
  it('tags exactly one tier, and the one the register declares', () => {
    for (const pkg of PACKAGES) {
      const manifest = readManifest(pkg.dir);

      expect(
        tierTagCount(manifest),
        `${pkg.name} carries ${tierTagCount(manifest)} 'tier:' tags; a package ` +
          'sits in exactly one tier',
      ).toBe(1);

      expect(
        tierTagOf(manifest),
        `${pkg.name} is registered as ${label(pkg.tier)} and its nx.tags say ` +
          `tier:${tierTagOf(manifest)}`,
      ).toBe(pkg.tier);
    }
  });
});

describe('Dependencies point down, or sideways within a tier', () => {
  it('has no package depending on one above it', () => {
    const upward: string[] = [];

    for (const pkg of PACKAGES) {
      const manifest = readManifest(pkg.dir);
      for (const dep of Object.keys(manifest.dependencies ?? {})) {
        const target = byName.get(dep);
        if (target === undefined || target.tier <= pkg.tier) continue;
        upward.push(
          `${pkg.name} (${label(pkg.tier)}) depends on ${dep} ` +
            `(${label(target.tier)})`,
        );
      }
    }

    expect(
      upward,
      'a tier may depend on its own or below, never above — an upward edge ' +
        'means the lower tier cannot be taken on its own:\n  ' +
        upward.join('\n  '),
    ).toEqual([]);
  });

  it('reaches outside entifix nowhere', () => {
    const foreign: string[] = [];

    for (const pkg of PACKAGES) {
      const manifest = readManifest(pkg.dir);
      for (const dep of Object.keys(manifest.dependencies ?? {})) {
        if (
          !(dep.startsWith('@r10c/') || dep.startsWith('@entifix/')) ||
          byName.has(dep)
        )
          continue;
        foreign.push(`${pkg.name} depends on ${dep}`);
      }
    }

    expect(
      foreign,
      'these are workspace packages entifix does not ship, so the published ' +
        'package would name a dependency that does not exist on npm — the ' +
        'value belongs on a seam, or the package belongs in the register:\n  ' +
        foreign.join('\n  '),
    ).toEqual([]);
  });
});

describe('An optional capability is never a hard dependency', () => {
  it('finds the capabilities it is meant to check', () => {
    for (const capability of OPTIONAL_CAPABILITIES) {
      expect(
        byName.has(capability.name),
        `${capability.name} is named as an optional capability but is not a ` +
          'registered package, so nothing below can see it',
      ).toBe(true);

      // An exemption that no longer applies is worse than none: it reads as a
      // considered decision while protecting a package that has since been
      // fixed, moved or renamed.
      for (const exception of capability.except ?? []) {
        const exempt = byName.get(exception.name);
        expect(
          exempt !== undefined &&
            capability.optionalFor.includes(exempt.tier) &&
            capability.name in (readManifest(exempt.dir).dependencies ?? {}),
          `${exception.name} is exempted from ${capability.name} and does not ` +
            'need to be — it is no longer a registered package in an affected ' +
            'tier, or no longer hard-depends on it. Delete the exemption.',
        ).toBe(true);
      }
    }
  });

  it('declares it as an optional peer instead', () => {
    const hard: string[] = [];

    for (const capability of OPTIONAL_CAPABILITIES) {
      for (const pkg of PACKAGES) {
        if (!capability.optionalFor.includes(pkg.tier)) continue;
        if (capability.except?.some(e => e.name === pkg.name)) continue;

        const manifest = readManifest(pkg.dir);
        if (!(capability.name in (manifest.dependencies ?? {}))) continue;

        hard.push(
          `${pkg.name} (${label(pkg.tier)}) hard-depends on ` +
            `${capability.name}, so anyone installing it also installs ` +
            `${capability.otherwiseInstalls}`,
        );
      }
    }

    expect(
      hard,
      'move the edge behind a subpath export and declare it in ' +
        'peerDependencies with peerDependenciesMeta.optional — package-level ' +
        'dependencies are not per-subpath, so the optional peer is the part ' +
        'that does the work:\n  ' +
        hard.join('\n  '),
    ).toEqual([]);
  });

  it('keeps the optional peer declared wherever the subpath still uses it', () => {
    // The other direction: a package that moved the edge to a subpath must
    // still *declare* the peer, or the subpath resolves to nothing for an
    // adopter who did want it and there is no warning anywhere.
    const undeclared: string[] = [];

    for (const capability of OPTIONAL_CAPABILITIES) {
      for (const pkg of PACKAGES) {
        if (!capability.optionalFor.includes(pkg.tier)) continue;

        const manifest = readManifest(pkg.dir);
        const isHard = capability.name in (manifest.dependencies ?? {});
        const mentioned = capability.name in (manifest.peerDependencies ?? {});
        if (isHard || !mentioned) continue;

        if (!declaresOptionalPeer(manifest, capability.name)) {
          undeclared.push(
            `${pkg.name} lists ${capability.name} as a peer without ` +
              'peerDependenciesMeta.optional, so every adopter is warned ' +
              'about a capability most of them do not want',
          );
        }
      }
    }

    expect(undeclared, undeclared.join('\n  ')).toEqual([]);
  });
});
