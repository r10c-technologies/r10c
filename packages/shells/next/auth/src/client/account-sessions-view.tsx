'use client';

import {
  Button,
  Card,
  HeadingOne,
  Lead,
  Overline,
  Stack,
  Text,
  useFormatters,
  useT,
} from '@r10c/entifix-react-controls';
import { useState } from 'react';

import { useAsyncResource } from './use-async-resource';

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
  if (!res.ok) throw new Error('sessions');
  const body = (await res.json()) as { items: SessionRow[] };
  return body.items;
};

/**
 * The caller's live sessions, with a way to end them.
 *
 * Ending the **current** session is allowed and simply signs you out — the
 * route handler clears this origin's cookies and the browser is sent back to
 * sign-in. Disabling that row would only have made people wonder why.
 */
export function SessionsView() {
  const t = useT('shell');
  const { dateTime } = useFormatters();
  const [busy, setBusy] = useState<string | null>(null);

  // Loading lives in the shared hook: a synchronous `setState` inside an effect
  // body trips `react-hooks/set-state-in-effect`, and the hook derives its flags
  // from the settled key instead.
  const {
    data: rows,
    isLoading,
    error,
    reload,
  } = useAsyncResource('account-sessions', readSessions);

  const revoke = async (row: SessionRow) => {
    setBusy(row.sessionId);
    try {
      const res = await fetch(`/api/auth/sessions/${row.sessionId}`, {
        method: 'DELETE',
      });
      const body = (await res.json()) as { signedOut?: boolean };
      if (body.signedOut === true) {
        // Our own cookies are gone; anything short of a full navigation would
        // render a shell the middleware is about to reject anyway.
        window.location.assign('/');
        return;
      }
      reload();
    } finally {
      setBusy(null);
    }
  };

  const revokeOthers = async () => {
    setBusy('others');
    try {
      await fetch('/api/auth/sessions', { method: 'POST' });
      reload();
    } finally {
      setBusy(null);
    }
  };

  const describe = (row: SessionRow): string => {
    if (row.device === null) return t('auth.sessions.unknownDevice');
    const parts = [row.device.browser, row.device.os].filter(Boolean);
    return parts.length > 0
      ? parts.join(' · ')
      : t('auth.sessions.unknownDevice');
  };

  return (
    <Stack gap="l">
      <header>
        <Stack gap="2xs">
          <Overline>{t('auth.sessions.overline')}</Overline>
          <HeadingOne>{t('auth.sessions.title')}</HeadingOne>
          <Lead>{t('auth.sessions.subtitle')}</Lead>
        </Stack>
      </header>

      {error !== undefined ? (
        <Card>
          <Text className="text-danger" role="alert">
            {t('auth.sessions.failed')}
          </Text>
        </Card>
      ) : null}

      {isLoading ? (
        <Card>
          <Text muted>{t('auth.sessions.loading')}</Text>
        </Card>
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
            <Button
              variant="secondary"
              size="sm"
              disabled={busy !== null}
              onClick={() => revoke(row)}
            >
              {busy === row.sessionId
                ? t('auth.sessions.revoking')
                : t('auth.sessions.revoke')}
            </Button>
          </Stack>
        </Card>
      ))}

      {rows !== undefined && rows.length <= 1 ? (
        <Text muted>{t('auth.sessions.empty')}</Text>
      ) : null}

      {rows !== undefined && rows.length > 1 ? (
        <Button
          variant="primary"
          disabled={busy !== null}
          onClick={revokeOthers}
        >
          {busy === 'others'
            ? t('auth.sessions.revoking')
            : t('auth.sessions.revokeOthers')}
        </Button>
      ) : null}
    </Stack>
  );
}
