'use client';

import {
  Button,
  Card,
  Stack,
  Text,
  useFormatters,
  useT,
} from '@r10c/entifix-react-controls';
import { useState } from 'react';

import { useAsyncResource } from '../../../../lib/use-async-resource';
import type { SessionRow } from '../../../(account)/account/sessions/sessions-view';

/** `null` means the caller is not allowed to see this — the panel disappears. */
const readUserSessions = async (
  userId: string,
): Promise<SessionRow[] | null> => {
  const res = await fetch(`/api/user-identity/${userId}/sessions`, {
    cache: 'no-store',
  });
  if (res.status === 401 || res.status === 403) return null;
  if (!res.ok) throw new Error('sessions');
  const body = (await res.json()) as { items: SessionRow[] };
  return body.items;
};

/**
 * An administrator's view of where a user is signed in, with a way to end it —
 * incident response for a compromised account.
 *
 * The panel simply disappears when the caller lacks `authn:user-device:read`,
 * because auth-service answers 403 and there is nothing to show. That is
 * presentation: hiding it protects nothing, and the service is what refuses.
 */
export function UserSessionsPanel({ userId }: { userId: string }) {
  const t = useT('app');
  const { dateTime } = useFormatters();
  const [busy, setBusy] = useState(false);

  const { data: rows, error, reload } = useAsyncResource(
    `user-sessions:${userId}`,
    () => readUserSessions(userId),
  );

  const kick = async () => {
    setBusy(true);
    try {
      await fetch(`/api/user-identity/${userId}/sessions`, {
        method: 'DELETE',
      });
      reload();
    } finally {
      setBusy(false);
    }
  };

  // Not permitted, or not loaded yet — either way there is nothing to render.
  if (rows === null || rows === undefined) {
    return error === undefined ? null : (
      <Card>
        <Text className="text-danger" role="alert">
          {t('auth.users.sessionsFailed')}
        </Text>
      </Card>
    );
  }

  return (
    <Card>
      <Stack gap="s">
        <Text>
          <strong>{t('auth.users.sessionsTitle')}</strong>
        </Text>

        {rows.map(row => (
          <Stack key={row.sessionId} gap="3xs">
            <Text>
              {row.device === null
                ? t('auth.sessions.unknownDevice')
                : [row.device.browser, row.device.os]
                    .filter(Boolean)
                    .join(' · ') || t('auth.sessions.unknownDevice')}
            </Text>
            <Text muted>
              {t('auth.sessions.startedAt')} {dateTime(new Date(row.createdAt))}
            </Text>
          </Stack>
        ))}

        {rows.length === 0 ? (
          <Text muted>{t('auth.users.sessionsEmpty')}</Text>
        ) : (
          <Button variant="secondary" size="sm" disabled={busy} onClick={kick}>
            {busy ? t('auth.users.kicking') : t('auth.users.kick')}
          </Button>
        )}
      </Stack>
    </Card>
  );
}
