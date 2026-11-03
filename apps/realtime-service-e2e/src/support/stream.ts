import { signAccessToken } from '@entifix/jwt';
import {
  E2E_KEY_ID,
  E2E_PRIVATE_KEY_PEM,
  E2E_PUBLIC_KEY_PEM,
} from '@entifix/testing-e2e/fixtures';
import {
  AUTH_TOKEN_AUDIENCE,
  AUTH_TOKEN_ISSUER,
} from '@r10c/business-ts-authn';

export interface Caller {
  readonly roles: readonly string[];
  readonly organizationId?: string;
  readonly partyId?: string;
  /** Seconds the token lives; 900 unless a spec needs it to expire. */
  readonly ttlSeconds?: number;
}

/** A signed access token for `caller`, verified by the mock's real jose adapter. */
export const tokenFor = (caller: Caller): Promise<string> =>
  signAccessToken(
    {
      userId: 'user-1',
      subject: 'user-1',
      sessionId: 'sess-1',
      roles: caller.roles,
      ...(caller.organizationId === undefined
        ? {}
        : { activeOrganizationId: caller.organizationId }),
      ...(caller.partyId === undefined ? {} : { partyId: caller.partyId }),
    },
    {
      privateKeyPem: E2E_PRIVATE_KEY_PEM,
      publicKeyPem: E2E_PUBLIC_KEY_PEM,
      keyId: E2E_KEY_ID,
      issuer: AUTH_TOKEN_ISSUER,
      audience: AUTH_TOKEN_AUDIENCE,
    },
    caller.ttlSeconds ?? 900,
  );

const sleep = (ms: number) =>
  new Promise(resolve => {
    setTimeout(resolve, ms);
  });

/** How long a spec waits to be sure something did **not** arrive. */
export const QUIET_MS = 300;

export interface Listener {
  readonly status: number;
  /** Waits until the text so far satisfies `holds`, or `ms` passes. */
  until(holds: (text: string) => boolean, ms?: number): Promise<string>;
  close(): void;
}

/**
 * Opens `GET /api/realtime/stream` and reads it in the background, resolving
 * once the opening frame is in — so an event delivered afterwards is one the
 * connection was already listening for.
 */
export const openStream = async (
  baseUrl: string,
  query: string,
  headers: Record<string, string> = {},
): Promise<Listener> => {
  const controller = new AbortController();
  const response = await fetch(`${baseUrl}/api/realtime/stream?${query}`, {
    headers,
    signal: controller.signal,
  });
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let text = '';
  void (async () => {
    for (;;) {
      const chunk = await reader?.read().catch(() => undefined);
      if (chunk === undefined || chunk.done) return;
      text += decoder.decode(chunk.value);
    }
  })();
  const listener: Listener = {
    status: response.status,
    until: async (holds, ms = 2000) => {
      const deadline = Date.now() + ms;
      while (!holds(text) && Date.now() < deadline) await sleep(10);
      return text;
    },
    close: () => controller.abort(),
  };
  if (response.status === 200) await listener.until(t => t.includes(': open'));
  return listener;
};

export const has = (needle: string) => (text: string) => text.includes(needle);
