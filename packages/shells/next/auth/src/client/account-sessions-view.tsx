'use client';

import type { EntifixFailure, UseCaseDescriptor } from '@entifix/core';
import {
  ActionBar,
  Alert,
  Card,
  HeadingOne,
  itemsForUseCases,
  Lead,
  LoadingBoundary,
  Overline,
  SkeletonText,
  Stack,
  Text,
  useErrorMessage,
  useFormatters,
  useT,
  useTranslateKey,
  useVerbInvoker,
} from '@entifix/react-controls';
import { useEntityUseCases } from '@entifix/react-integration';
import { UserDevice, UserIdentity } from '@r10c/business-ts-authn';
import { useState } from 'react';

import { createClientAdapters } from './adapters/create-client-adapters';
import { failedResponse } from './failed-response';
import { runSessionVerb, type SessionTarget } from './session-verbs';
import { useAsyncResource } from './use-async-resource';

const { metadata: metadataSource } = createClientAdapters();

/** A session row as the service reports it. */
export interface SessionRow {
  readonly sessionId: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly absoluteExpiresAt: string;
  readonly current: boolean;
  readonly device: {
    readonly deviceId: string;
    readonly browser?: string;
    readonly os?: string;
    readonly type?: string;
    readonly ip?: string;
  } | null;
}

const readSessions = async (): Promise<SessionRow[]> => {
  const res = await fetch('/api/auth/sessions', { cache: 'no-store' });
  if (!res.ok) throw await failedResponse(res);
  const body = (await res.json()) as { items: SessionRow[] };
  return body.items;
};

/**
 * The caller's live sessions, with a way to end them.
 *
 * Every verb here is a declared one, read from the served `$metadata` — so a
 * caller without the grant sees no button — and run through `useVerbInvoker`,
 * which asks before a destructive verb runs (ADR 0026). Nothing here posts
 * around it.
 *
 * Ending the **current** session is allowed and simply signs you out — the
 * route handler clears this origin's cookies and the browser is sent back to
 * sign-in. Disabling that row would only have made people wonder why.
 */
export function SessionsView() {
  const t = useT('r10c');
  const translateKey = useTranslateKey();
  const errorMessage = useErrorMessage();
  const { dateTime } = useFormatters();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<EntifixFailure | undefined>(undefined);

  // Loading lives in the shared hook: a synchronous `setState` inside an effect
  // body trips `react-hooks/set-state-in-effect`, and the hook derives its flags
  // from the settled key instead.
  const {
    data: rows,
    isLoading,
    error,
    reload,
  } = useAsyncResource('account-sessions', readSessions);

  const { metadata: deviceMetadata } = useEntityUseCases(
    UserDevice,
    metadataSource,
  );
  const { metadata: identityMetadata } = useEntityUseCases(
    UserIdentity,
    metadataSource,
  );
  const verb = (
    descriptors: readonly UseCaseDescriptor[] | undefined,
    key: string,
  ) => descriptors?.filter(descriptor => descriptor.key === key) ?? [];
  const signOutSession = verb(deviceMetadata?.useCases, 'sign-out-session');
  const signOutOthers = verb(identityMetadata?.useCases, 'sign-out-others');

  const run = async (key: string, target: SessionTarget) => {
    setBusy(true);
    setFailure(undefined);
    try {
      const outcome = await runSessionVerb(key, target);
      if (outcome === undefined) return;
      if (!outcome.ok) {
        // A refusal is shown, never swallowed: a revocation that silently did
        // nothing leaves a stolen session open while the screen says otherwise.
        setFailure(outcome.failure);
        return;
      }
      if (outcome.signedOut) {
        // Our own cookies are gone; anything short of a full navigation would
        // render a shell the proxy is about to reject anyway.
        window.location.assign('/');
        return;
      }
      reload();
    } finally {
      setBusy(false);
    }
  };

  const verbs = useVerbInvoker<SessionTarget>({
    run: (key, target) => void run(key, target),
    busy,
    served: [
      ...(deviceMetadata?.useCases ?? []),
      ...(identityMetadata?.useCases ?? []),
    ],
  });

  const describe = (row: SessionRow): string => {
    if (row.device === null) return t('auth.sessions.unknownDevice');
    const parts = [row.device.browser, row.device.os].filter(Boolean);
    return parts.length > 0
      ? parts.join(' · ')
      : t('auth.sessions.unknownDevice');
  };

  const others = rows?.filter(row => !row.current).length ?? 0;

  return (
    <Stack gap="l">
      <header>
        <Stack gap="2xs">
          <Overline>{t('auth.sessions.overline')}</Overline>
          <HeadingOne>{t('auth.sessions.title')}</HeadingOne>
          <Lead>{t('auth.sessions.subtitle')}</Lead>
        </Stack>
      </header>

      {error === undefined ? null : (
        <Alert tone="danger">{t('auth.sessions.failed')}</Alert>
      )}

      {failure === undefined ? null : (
        <Alert tone="danger">{errorMessage(failure)}</Alert>
      )}

      {/* Card-shaped placeholders rather than the word "Loading": the rows that
          land are cards, so the swap shifts nothing. The copy survives as the
          announcement, since the shimmer is hidden from assistive tech. */}
      {isLoading ? (
        <LoadingBoundary
          isLoading
          label={t('auth.sessions.loading')}
          fallback={
            <Stack gap="2xs">
              {[0, 1].map(row => (
                <Card key={row}>
                  <SkeletonText lines={3} />
                </Card>
              ))}
            </Stack>
          }
        >
          {null}
        </LoadingBoundary>
      ) : null}

      {rows?.map(row => (
        <Card key={row.sessionId}>
          <Stack gap="2xs">
            <Text>
              <strong>{describe(row)}</strong>
              {row.current ? ` — ${t('auth.sessions.current')}` : ''}
            </Text>
            <Text muted>
              {t('auth.sessions.startedAt')} {dateTime(new Date(row.createdAt))}
            </Text>
            <Text muted>
              {t('auth.sessions.expiresAt')}{' '}
              {dateTime(new Date(row.absoluteExpiresAt))}
            </Text>
            {row.device?.ip === undefined ? null : (
              <Text muted>
                {t('auth.sessions.lastIp')} {row.device.ip}
              </Text>
            )}
            {signOutSession.length === 0 ? null : (
              <ActionBar
                surface="row-menu"
                size="sm"
                menuLabel={t('auth.sessions.actionsFor', {
                  device: describe(row),
                })}
                items={itemsForUseCases(
                  signOutSession,
                  translateKey,
                  descriptor =>
                    verbs.invoke({
                      descriptor,
                      target: { kind: 'one', sessionId: row.sessionId },
                      object: describe(row),
                      count: 1,
                    }),
                  busy,
                )}
              />
            )}
          </Stack>
        </Card>
      ))}

      {rows !== undefined && others === 0 ? (
        <Text muted>{t('auth.sessions.empty')}</Text>
      ) : null}

      {others > 0 && signOutOthers.length > 0 ? (
        <ActionBar
          surface="table-toolbar"
          items={itemsForUseCases(
            signOutOthers,
            translateKey,
            descriptor =>
              verbs.invoke({
                descriptor,
                target: { kind: 'others' },
                object: t('auth.sessions.othersCount', { count: others }),
                count: others,
              }),
            busy,
          )}
        />
      ) : null}

      {verbs.dialog}
    </Stack>
  );
}
