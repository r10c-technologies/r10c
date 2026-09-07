'use client';

import {
  useCasesForSurface,
  useT,
  useTranslateKey,
} from '@r10c/entifix-react-controls';
import { useEntityUseCases } from '@r10c/entifix-react-integration';
import {
  type CommandOption,
  type CommandSource,
  EntifixLogicError,
  type Entity,
  type EntityConstructor,
  type EntityMetadataSource,
  envelopeEntityName,
  matchesCommand,
  parseKeywords,
} from '@r10c/entifix-ts-core';
import { useMemo } from 'react';

/** How a declared verb is actually carried out, keyed by the verb. */
export type UseCaseHandlers = Readonly<Record<string, () => Promise<void>>>;

/** One entity whose served affordances contribute palette commands. */
export interface UseCaseCommandEntity<TEntity extends Entity = Entity> {
  readonly entityConstructor: EntityConstructor<TEntity>;
  /** Where `GET /api/<entity>/$metadata` is reached. */
  readonly metadataSource: EntityMetadataSource;
  readonly handlers: UseCaseHandlers;
}

/**
 * The `unbound` verbs this caller may invoke, as one group.
 *
 * This is the surface ADR 0035 mapped and nothing rendered: all three
 * `unbound:*` cells resolve to `'command-palette'`, and until now the palette
 * did not exist, so a verb declared there was granted, exported, passed every
 * `@r10c/slices` invariant and simply never appeared.
 *
 * The descriptors are **served, not imported**: `$metadata` filters them through
 * `PolicyDecisionTag` against the verified principal, which is a stronger check
 * than anything the browser could do — and it keeps every `@useCase()` class's
 * `Effect` body, repository tags and import closure out of the client bundle.
 *
 * ⚠️ A descriptor with **no handler throws**, at the first render of the
 * palette rather than on the click. A verb that appears and does nothing is
 * worse than one that is absent: it reads as a broken feature rather than a
 * missing wire, and it is the same posture `assertSearchable` and `surfaceFor`
 * already take.
 */
function useUseCasesSource(
  entity: UseCaseCommandEntity,
  term: string,
): CommandSource {
  const t = useT('shell');
  const translateKey = useTranslateKey();
  const { metadata, isLoading } = useEntityUseCases(
    entity.entityConstructor,
    entity.metadataSource,
  );

  // Outside the memo: `useCasesForSurface` is a plain filter, but the name reads
  // as a hook to `react-hooks/rules-of-hooks`, which then refuses it inside a
  // callback. Hoisting is free — it is pure and cheap.
  const descriptors = useCasesForSurface('command-palette', metadata?.useCases);

  return useMemo(() => {
    const name = envelopeEntityName(entity.entityConstructor);

    const options: CommandOption[] = descriptors.map(descriptor => {
      const run = entity.handlers[descriptor.key];
      if (run === undefined) {
        throw new EntifixLogicError(
          `The use case "${descriptor.key}" on ${name} reaches the command palette but this host registered no handler for it. ` +
            'Add one to the entity’s `handlers`, or stop declaring the verb `unbound`.',
          undefined,
          { entity: name, key: descriptor.key },
        );
      }

      return {
        id: `use-case:${name}:${descriptor.key}`,
        label: translateKey(descriptor.labelKey),
        keywords: parseKeywords(
          descriptor.keywordsKey === undefined
            ? undefined
            : translateKey(descriptor.keywordsKey),
        ),
        run,
        ...(descriptor.confirm === undefined
          ? {}
          : {
              confirm: {
                tone: descriptor.confirm.tone,
                message: translateKey(descriptor.confirm.messageKey),
              },
            }),
      } satisfies CommandOption;
    });

    return {
      key: `use-cases:${name}`,
      groups: [
        {
          key: `use-cases:${name}`,
          label: t('commandPalette.groups.actions'),
          options: options.filter(option => matchesCommand(term, option)),
          isLoading,
        },
      ],
    } satisfies CommandSource;
  }, [entity, descriptors, isLoading, term, t, translateKey]);
}

/**
 * Every declared entity's palette verbs, as one source per entity.
 *
 * **Why the rule is disabled below.** `entities` is declared once at module
 * scope by the host and closed over, so it is the same array on every render and
 * the hook count is fixed — the invariant `react-hooks/rules-of-hooks` protects
 * and cannot see, because it reasons about the loop syntactically rather than
 * about the array's provenance. It is isolated here so the disable is written
 * once, with its reason, exactly as `useEntityLinkSources` does for pickers.
 */
export function useUseCaseSources(
  entities: readonly UseCaseCommandEntity[],
  term: string,
): CommandSource[] {
  const sources: CommandSource[] = [];
  for (const entity of entities) {
    // eslint-disable-next-line react-hooks/rules-of-hooks -- fixed-length loop over a module-scope array; see the note above.
    sources.push(useUseCasesSource(entity, term));
  }
  return sources;
}
