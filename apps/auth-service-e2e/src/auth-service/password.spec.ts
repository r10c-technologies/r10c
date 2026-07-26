import { defineServiceE2e } from '@r10c/entifix-ts-testing-e2e/service';

import { startMockService } from '../support/mock-service';

/**
 * Password change, recovery and lockout — the whole point of the dev outbox.
 *
 * The reset link is never returned in a response body, so these journeys read it
 * back from `/api/dev/outbox` exactly as a person would read it from an email.
 */
const service = defineServiceE2e({
  liveUrlEnvVar: 'AUTH_SERVICE_URL',
  startMock: startMockService,
});

const password = 'correct-horse-battery';

const register = async (label: string) => {
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const res = await service.client.post('/api/auth/register', {
    password,
    identifiers: [{ type: 'email', value: email }],
  });
  return { email, session: res.data };
};

const asUser = (accessToken: string) => ({
  headers: { Authorization: `Bearer ${accessToken}` },
});

const resetLinkFor = async (email: string): Promise<string | undefined> => {
  const res = await service.client.get(
    `/api/dev/outbox?to=${encodeURIComponent(email)}`,
  );
  const item = (
    res.data.items as Array<{ kind: string; data: Record<string, string> }>
  ).find(entry => entry.kind === 'password-reset');
  return item?.data['link'];
};

const tokenFrom = (link: string): string =>
  new URL(link).searchParams.get('token') ?? '';

describe('changing your own password', () => {
  it('requires the current password', async () => {
    const { session } = await register('change-wrong');

    const res = await service.client.post(
      '/api/auth/password',
      { currentPassword: 'not-the-password', newPassword: 'a-brand-new-one' },
      asUser(session.accessToken),
    );

    // Holding a session proves how you got in, not who you are — an unlocked
    // laptop must not become permanent ownership of the account.
    expect(res.status).toBe(401);
    expect(res.data.code).toBe('passwordIncorrect');
  });

  it('refuses a password below the minimum length', async () => {
    const { session } = await register('change-short');

    const res = await service.client.post(
      '/api/auth/password',
      { currentPassword: password, newPassword: 'short' },
      asUser(session.accessToken),
    );

    expect(res.status).toBe(409);
    expect(res.data.code).toBe('passwordTooShort');
  });

  it('changes the password and keeps the caller signed in', async () => {
    const { email, session } = await register('change-ok');
    const other = await service.client.post('/api/auth/login', {
      identifier: email,
      password,
    });

    const res = await service.client.post(
      '/api/auth/password',
      { currentPassword: password, newPassword: 'a-brand-new-one' },
      asUser(session.accessToken),
    );
    expect(res.status).toBe(200);

    // Mine survives — being signed out of the screen you just used reads as a
    // failure, not as security.
    const mine = await service.client.post('/api/auth/refresh', {
      sessionId: session.sessionId,
    });
    expect(mine.status).toBe(200);
    // Every other session is gone.
    const theirs = await service.client.post('/api/auth/refresh', {
      sessionId: other.data.sessionId,
    });
    expect(theirs.status).toBe(401);

    // And the new password is the one that works now.
    const relogin = await service.client.post('/api/auth/login', {
      identifier: email,
      password: 'a-brand-new-one',
    });
    expect(relogin.status).toBe(200);
  });

  it('401s an unauthenticated caller', async () => {
    const res = await service.client.post('/api/auth/password', {
      currentPassword: password,
      newPassword: 'a-brand-new-one',
    });

    expect(res.status).toBe(401);
  });
});

describe('password recovery', () => {
  it('answers 202 for an address that does not exist', async () => {
    const res = await service.client.post('/api/auth/password/forgot', {
      identifier: 'nobody-at-all@example.com',
    });

    // Identical to the hit case: a different status or body here is how an
    // attacker enumerates who has an account.
    expect(res.status).toBe(202);
    expect(await resetLinkFor('nobody-at-all@example.com')).toBeUndefined();
  });

  it('emails a link that sets a new password and kills every session', async () => {
    const { email, session } = await register('recover');

    const asked = await service.client.post('/api/auth/password/forgot', {
      identifier: email,
    });
    expect(asked.status).toBe(202);
    // Never in the response body — only in the message.
    expect(JSON.stringify(asked.data)).not.toContain('token');

    const link = await resetLinkFor(email);
    expect(link).toBeDefined();

    const reset = await service.client.post('/api/auth/password/reset', {
      token: tokenFrom(link as string),
      newPassword: 'recovered-password',
    });
    expect(reset.status).toBe(200);

    // Recovery exists because the old password may be in someone else's hands,
    // and they may be signed in right now — so EVERY session goes, including
    // the one that asked.
    const old = await service.client.post('/api/auth/refresh', {
      sessionId: session.sessionId,
    });
    expect(old.status).toBe(401);

    const relogin = await service.client.post('/api/auth/login', {
      identifier: email,
      password: 'recovered-password',
    });
    expect(relogin.status).toBe(200);
  });

  it('spends the link on first use', async () => {
    const { email } = await register('single-use');
    await service.client.post('/api/auth/password/forgot', {
      identifier: email,
    });
    const token = tokenFrom((await resetLinkFor(email)) as string);

    const first = await service.client.post('/api/auth/password/reset', {
      token,
      newPassword: 'first-attempt-wins',
    });
    const second = await service.client.post('/api/auth/password/reset', {
      token,
      newPassword: 'second-attempt-loses',
    });

    expect(first.status).toBe(200);
    // A copy in a mail archive or a proxy log is already worthless.
    expect(second.status).toBe(401);
    expect(second.data.code).toBe('invalidResetToken');
  });

  it('rejects a token that was never issued', async () => {
    const res = await service.client.post('/api/auth/password/reset', {
      token: 'not-a-real-token',
      newPassword: 'does-not-matter',
    });

    expect(res.status).toBe(401);
    expect(res.data.code).toBe('invalidResetToken');
  });
});

describe('lockout', () => {
  it('refuses further attempts after repeated failures, then notifies', async () => {
    const { email } = await register('locked-out');
    const source = { deviceId: 'attacker-device' };

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const res = await service.client.post('/api/auth/login', {
        identifier: email,
        password: 'wrong-every-time',
        device: source,
      });
      expect(res.status).toBe(401);
    }

    const locked = await service.client.post('/api/auth/login', {
      identifier: email,
      password: 'wrong-every-time',
      device: source,
    });
    expect(locked.status).toBe(429);
    expect(locked.data.code).toBe('accountLocked');

    // The owner is told, so a targeted attempt is visible rather than silent.
    const res = await service.client.get(
      `/api/dev/outbox?to=${encodeURIComponent(email)}`,
    );
    expect(
      (res.data.items as Array<{ kind: string }>).filter(
        item => item.kind === 'account-locked',
      ).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it('refuses the RIGHT password too while locked', async () => {
    const { email } = await register('locked-correct');
    const source = { deviceId: 'fumbling-device' };

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await service.client.post('/api/auth/login', {
        identifier: email,
        password: 'wrong',
        device: source,
      });
    }

    const res = await service.client.post('/api/auth/login', {
      identifier: email,
      password,
      device: source,
    });

    // 429, not 401 — otherwise someone goes off resetting a password that was
    // never wrong.
    expect(res.status).toBe(429);
  });

  it('does not lock a victim out from a source they are not using', async () => {
    const { email } = await register('nat-neighbour');

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await service.client.post('/api/auth/login', {
        identifier: email,
        password: 'wrong',
        device: { deviceId: 'attacker-device' },
      });
    }

    const victim = await service.client.post('/api/auth/login', {
      identifier: email,
      password,
      device: { deviceId: 'victims-own-laptop' },
    });

    // The whole reason the counter is keyed identifier+source: one attacker
    // must not be able to lock a person out of their own account on purpose.
    expect(victim.status).toBe(200);
  });

  it('clears the count after a successful sign-in', async () => {
    const { email } = await register('forgiven');
    const source = { deviceId: 'forgetful-device' };

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await service.client.post('/api/auth/login', {
        identifier: email,
        password: 'wrong',
        device: source,
      });
    }
    await service.client.post('/api/auth/login', {
      identifier: email,
      password,
      device: source,
    });

    // Four more would trip the lock if the earlier ones still counted.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const res = await service.client.post('/api/auth/login', {
        identifier: email,
        password: 'wrong',
        device: source,
      });
      expect(res.status).toBe(401);
    }
  });
});
