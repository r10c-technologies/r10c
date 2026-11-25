import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  BUSINESS_ROOT,
  entityDeclarations,
  sourceFiles,
} from './source-scan.js';

/**
 * Which states a person may save or delete a record in is declared on the
 * entity — `@entity({ writableWhen, deletableWhen })` — and that one
 * declaration drives the form, `$metadata` and the store's own refusal
 * (entifix ADR 0029 §6–§7). This is the check that every record a person
 * edits has been decided: it is **state-bound**, and declares the states, or
 * **always writable**, with the reason a record in any state may still be
 * saved and deleted. A hand-written "released, so refused" in a `prepare` is
 * exactly the drift the declaration replaced (#767).
 *
 * A record a person edits is one that declares a `revision` — the revision
 * check's own register of authored documents (`revision.spec.ts`).
 */
const STATE_BOUND: Readonly<
  Record<string, { readonly write: boolean; readonly delete: boolean }>
> = {
  // A released version is frozen; orders name it (ADR 0079 §1).
  ProductSpecification: { write: true, delete: true },
  // Edited and published again in any status (ADR 0047), deleted only off
  // sale: a delete announces nothing, so a published one would stay projected.
  ProductOffering: { write: false, delete: true },
};

/** Why each authored record is saved and deleted whatever its state. */
const ALWAYS_WRITABLE: Readonly<Record<string, string>> = {
  DeviceModel:
    'retiring withdraws it from new choices; a retired one is still corrected',
  ProductBrand:
    'retiring withdraws it from new choices; a retired one is still corrected',
  ProductCategory:
    'retiring withdraws it from new choices; a retired one is still corrected',
  DictionaryTerm: 'holds no state',
  ProductOfferingPrice: 'holds no state',
  EntitySpecification:
    'no route writes it yet (ADR 0014, Proposed); decide when one is mounted',
  CharacteristicSpecification: 'holds no state',
  SalesChannel:
    'an inactive channel is still renamed and reactivated; only selling needs it active',
  Agreement: 'holds no state',
  Configuration: 'holds no state',
};

/** Every `@entity()` class: its options as written, and its whole file. */
const entities = () => {
  const found = new Map<
    string,
    { readonly options: string; readonly source: string }
  >();
  for (const file of sourceFiles(BUSINESS_ROOT)) {
    const text = readFileSync(file, 'utf8');
    for (const { className, options } of entityDeclarations(text)) {
      if (className !== undefined)
        found.set(className, { options, source: text });
    }
  }
  return found;
};

/** Whether `source` declares a `revision` member: a document a person edits. */
const authored = (source: string) => /type:\s*'revision'/.test(source);

describe('the states a record is saved and deleted in', () => {
  const all = entities();
  const authoredNames = [...all]
    .filter(([, { source }]) => authored(source))
    .map(([name]) => name)
    .sort();

  it('decides every record a person edits', () => {
    expect(authoredNames).toEqual(
      [...Object.keys(STATE_BOUND), ...Object.keys(ALWAYS_WRITABLE)].sort(),
    );
  });

  it.each(Object.entries(STATE_BOUND))(
    '%s declares the states it is saved and deleted in',
    (name, declared) => {
      const options = all.get(name)?.options ?? '';
      expect(/writableWhen:/.test(options)).toBe(declared.write);
      expect(/deletableWhen:/.test(options)).toBe(declared.delete);
      // A form that stops taking input says why (entifix ADR 0029 §6).
      if (declared.write) expect(options).toMatch(/readOnlyReasonKey:/);
    },
  );

  it.each(Object.keys(ALWAYS_WRITABLE))(
    '%s declares no write or delete states',
    name => {
      const options = all.get(name)?.options ?? '';
      expect(options).not.toMatch(/writableWhen:|deletableWhen:/);
    },
  );

  it('leaves no hand-written status refusal in a save', () => {
    // The code the declaration replaced; a domain that grows another like it
    // declares the states instead.
    const offenders = [...sourceFiles(BUSINESS_ROOT)].filter(file =>
      /Failure\.conflict<\w*Released>/.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
