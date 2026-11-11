'use client';

import {
  Alert,
  Card,
  Stack,
  Text,
  useFormatters,
  useT,
} from '@entifix/react-controls';

import type { SessionRow } from './account-sessions-view';
import { failedResponse } from './failed-response';
import { useAsyncResource } from './use-async-resource';

/** `null` means the caller is not allowed to see this — the panel disappears. */
const readUserSessions = async (
  userId: string,
): Promise<SessionRow[] | null> => {
  const res = await fetch(`/api/user-identity/${userId}/sessions`, {
    cache: 'no-store',
  });
  if (res.status === 401 || res.status === 403) return null;
  if (!res.ok) throw await failedResponse(res);
  const body = (await res.json()) as { items: SessionRow[] };
  return body.items;
};

/**
 * An administrator's view of where a user is signed in — incident response for
 * a compromised account.
 *
 * It lists and does not act. Ending those sessions is the `revoke-sessions`
 * verb, which the record's form renders in its header from the served
 * descriptor, behind its confirmation; a second button here used to post the
 * same verb around that dialog. The page remounts this panel after the verb
 * runs, so the list it shows is the one left behind.
 *
 * The panel simply disappears when the caller lacks `authn:user-device:read`,
 * because auth-service answers 403 and there is nothing to show. That is
 * presentation: hiding it protects nothing, and the service is what refuses.
 */
export function UserSessionsPanel({ userId }: { userId: string }) {
  const t = useT('r10c');
  const { dateTime } = useFormatters();

  const { data: rows, error } = useAsyncResource(
    `user-sessions:${userId}`,
    () => readUserSessions(userId),
  );

  // Not permitted, or not loaded yet — either way there is nothing to render.
  if (rows === null || rows === undefined) {
    return error === undefined ? null : (
      <Alert tone="danger">{t('auth.users.sessionsFailed')}</Alert>
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
        ) : null}
      </Stack>
    </Card>
  );
}
