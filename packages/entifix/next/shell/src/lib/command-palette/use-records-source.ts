'use client';

import { useT, useTranslateKey } from '@r10c/entifix-react-controls';
import type {
  CommandGroup,
  CommandSource,
  CommandUnavailableSeverity,
} from '@r10c/entifix-ts-core';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useLocaleHref } from '../i18n';
import type {
  RecordSearchResponse,
  RecordSearchUnavailableReason,
} from '../search/record-search.types';
import { searchRecords } from '../search/search-records';
import {
  RECORD_SEARCH_DEBOUNCE_MS,
  RECORD_SEARCH_MIN_TERM,
} from './palette-command';

/**
 * Which reasons are the caller's ordinary state, and which mean something broke.
 *
 * The split is ADR 0040's, restated as severity because that is what the palette
 * renders. An operator holds no membership, so every tenant-plane source answers
 * `409` on every keystroke — painting that as an outage teaches them to ignore
 * the row entirely, and then the `timeout` that does matter goes unread too.
 */
const SEVERITY: Readonly<
  Record<RecordSearchUnavailableReason, CommandUnavailableSeverity>
> = {
  forbidden: 'scope',
  noActiveOrganization: 'scope',
  unauthenticated: 'scope',
  timeout: 'reachability',
  network: 'reachability',
  invalidQuery: 'reachability',
  notFound: 'reachability',
  unexpected: 'reachability',
};

/** What the browser is currently showing for records. */
interface RecordsState {
  /** The term this answer is for, so a stale response cannot overwrite a newer one. */
  readonly term: string;
  readonly response?: RecordSearchResponse;
  readonly failed: boolean;
}

const NOTHING_YET: RecordsState = { term: '', failed: false };

/**
 * Records matching the term, one group per source, in the order the host
 * declared them.
 *
 * The whole of the *keystroke* policy lives here rather than in `searchRecords`,
 * which is deliberately a bare typed `fetch`: the palette is the thing that
 * knows a keystroke is not a query. So this owns the debounce, the abort and the
 * two-character floor, while the route owns the fan-out, the per-source timeout
 * and the authorization.
 *
 * **No index, ever.** Every option here came back from `/api/search` for this
 * principal and this organization, on this keystroke. A prefetched client index
 * is the shape that surfaces another organization's record the first time a
 * session's scope moves under it, and ADR 0040 forecloses it permanently.
 *
 * Below the two-character floor the group is present and **says why** rather
 * than being empty or absent: empty would claim nothing matched a search that
 * never ran, and absent would leave someone wondering whether records are
 * searchable here at all.
 */
export function useRecordsSource(term: string, enabled: boolean): CommandSource {
  const t = useT('shell');
  const translateKey = useTranslateKey();
  const withLocale = useLocaleHref();

  const [state, setState] = useState<RecordsState>(NOTHING_YET);
  // The term the request in flight is for. A ref, not state: it changes on every
  // keystroke and nothing renders from it.
  const pending = useRef<string | null>(null);

  const active = enabled && term.length >= RECORD_SEARCH_MIN_TERM;

  useEffect(() => {
    // Nothing is cleared here on purpose. A `setState` in an effect body is a
    // cascading render, and there is nothing to clear: the memo below returns no
    // groups while inactive, so a previous answer is unreachable rather than
    // stale — and the host empties the term when it opens the palette.
    if (!active) {
      pending.current = null;
      return;
    }

    const controller = new AbortController();
    pending.current = term;

    const timer = setTimeout(() => {
      void searchRecords(term, { signal: controller.signal })
        .then(response => {
          if (pending.current !== term) return;
          setState({ term, response, failed: false });
        })
        .catch(() => {
          // An abort lands here too and must not be shown: the term moved on,
          // so there is nothing to report about the request that did not finish.
          if (controller.signal.aborted || pending.current !== term) return;
          setState({ term, failed: true });
        });
    }, RECORD_SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [active, term]);

  return useMemo(() => {
    const heading = t('commandPalette.groups.records');

    if (!active) {
      // Someone who has typed one character is mid-word, not looking at an
      // answer. Saying so is better than both alternatives: an empty group would
      // claim nothing matched a search that never ran, and an absent one would
      // leave them wondering whether records are searchable at all.
      if (!enabled || term.length === 0) return { key: 'records', groups: [] };
      return {
        key: 'records',
        groups: [
          {
            key: 'records',
            label: heading,
            options: [],
            isLoading: false,
            unavailable: {
              message: t('commandPalette.typeMore', {
                count: RECORD_SEARCH_MIN_TERM,
              }),
              severity: 'scope',
            },
          },
        ],
      };
    }
    // A newer term is in flight. The previous answer stays on screen with its
    // groups marked loading rather than blanking: a list that empties between
    // keystrokes flickers, and the rows it drops were correct a moment ago.
    const isLoading = state.term !== term;

    if (state.response === undefined) {
      return {
        key: 'records',
        groups: [
          {
            key: 'records',
            label: heading,
            options: [],
            isLoading: !state.failed,
            // The whole endpoint failed — a lapsed session or a `400`, both of
            // which arrive as a rejection rather than inside a `200`. It is
            // named for the same reason a single degraded source is.
            ...(state.failed
              ? {
                  unavailable: {
                    message: t('commandPalette.unavailableReach', {
                      reason: translateKey('errors:unexpected'),
                    }),
                    severity: 'reachability' as const,
                  },
                }
              : {}),
          },
        ],
      };
    }

    const groups: CommandGroup[] = state.response.groups.map(group => ({
      key: `record:${group.source}`,
      // The entity's own `pluralKey`, so record search introduces no copy of
      // its own and a group is titled exactly as its screen is.
      label: translateKey(group.labelKey),
      options: group.items.map(item => ({
        id: `record:${group.source}:${item.id}`,
        label: item.label,
        ...(item.sublabel === undefined ? {} : { sublabel: item.sublabel }),
        href: withLocale(item.href),
      })),
      total: group.total,
      isLoading,
    }));

    for (const degraded of state.response.unavailable) {
      const severity = SEVERITY[degraded.reason];
      groups.push({
        key: `record:${degraded.source}`,
        // Derived from the entity rather than from the source key, which is an
        // identifier and would render as `product-specification`. Every
        // searchable entity declares a `pluralKey` — `catalogSurface` throws
        // without one — so this always resolves.
        label: translateKey(`entity:${degraded.entity}.plural`),
        options: [],
        isLoading: false,
        unavailable: {
          message: t(
            severity === 'scope'
              ? 'commandPalette.unavailableScope'
              : 'commandPalette.unavailableReach',
            { reason: translateKey(`errors:${degraded.reason}`) },
          ),
          severity,
        },
      });
    }

    return { key: 'records', groups };
  }, [active, enabled, state, term, t, translateKey, withLocale]);
}
