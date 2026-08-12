import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  makeZitadelManagement,
  type ZitadelManagementConfig,
  ZitadelManagementLayer,
  ZitadelManagementTag,
} from './management-client.js';

const config: ZitadelManagementConfig = {
  issuer: 'https://idp.test',
  personalAccessToken: 'pat-1',
};

let fetchMock: ReturnType<typeof vi.fn>;

const answers = (body: unknown, ok = true, status = ok ? 200 : 500) =>
  fetchMock.mockResolvedValue({
    ok,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
  });

const lastCall = () => {
  const call = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return {
    url: call[0],
    method: call[1].method,
    headers: call[1].headers as Record<string, string>,
    body:
      call[1].body === undefined ? undefined : JSON.parse(String(call[1].body)),
  };
};

const management = () => makeZitadelManagement(config);

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('authentication', () => {
  it('presents the machine token on every call', async () => {
    answers({ result: [] });

    await Effect.runPromise(management().findUserByEmail('a@example.com'));

    expect(lastCall().headers['authorization']).toBe('Bearer pat-1');
  });

  it('tolerates a trailing slash on the issuer', async () => {
    answers({ result: [] });

    await Effect.runPromise(
      makeZitadelManagement({
        ...config,
        issuer: 'https://idp.test/',
      }).findUserByEmail('a@example.com'),
    );

    expect(lastCall().url).toBe('https://idp.test/management/v1/users/_search');
  });
});

describe('findUserByEmail', () => {
  it('maps a match onto the shape r10c projects from', async () => {
    answers({
      result: [
        {
          id: 'user-9',
          userName: 'ada@example.com',
          state: 'USER_STATE_ACTIVE',
          human: {
            profile: { displayName: 'Ada Lovelace' },
            email: { email: 'ada@example.com', isEmailVerified: true },
          },
        },
      ],
    });

    const user = await Effect.runPromise(
      management().findUserByEmail('ada@example.com'),
    );

    expect(user).toEqual({
      userId: 'user-9',
      username: 'ada@example.com',
      email: 'ada@example.com',
      emailVerified: true,
      displayName: 'Ada Lovelace',
      active: true,
    });
  });

  it('searches case-insensitively', async () => {
    // Addresses arrive from a form and from an id_token, and the two disagree
    // about case often enough that an exact match would duplicate accounts.
    answers({ result: [] });

    await Effect.runPromise(management().findUserByEmail('Ada@Example.com'));

    expect(lastCall().body.queries[0].emailQuery.method).toBe(
      'TEXT_QUERY_METHOD_EQUALS_IGNORE_CASE',
    );
  });

  it('answers null rather than failing when nobody matches', async () => {
    answers({});

    const user = await Effect.runPromise(
      management().findUserByEmail('nobody@example.com'),
    );

    expect(user).toBeNull();
  });

  it('reports an inactive user as inactive', async () => {
    answers({
      result: [{ id: 'u', userName: 'u', state: 'USER_STATE_INACTIVE' }],
    });

    const user = await Effect.runPromise(
      management().findUserByEmail('u@x.io'),
    );

    expect(user?.active).toBe(false);
    expect(user?.emailVerified).toBe(false);
  });

  it('survives a row with no login name', async () => {
    // A machine user, or a human mid-import, has none. The projection must
    // still produce a record rather than `undefined` reaching the entity.
    answers({ result: [{ id: 'u' }] });

    const user = await Effect.runPromise(
      management().findUserByEmail('u@x.io'),
    );

    expect(user?.username).toBe('');
  });
});

describe('getUser', () => {
  it('maps the v2 shape', async () => {
    answers({
      user: {
        userId: 'user-2',
        username: 'alan',
        state: 'USER_STATE_ACTIVE',
        human: {
          profile: { displayName: 'Alan Turing' },
          email: { email: 'alan@example.com', isVerified: true },
        },
      },
    });

    const user = await Effect.runPromise(management().getUser('user-2'));

    expect(user).toEqual({
      userId: 'user-2',
      username: 'alan',
      email: 'alan@example.com',
      emailVerified: true,
      displayName: 'Alan Turing',
      active: true,
    });
    expect(lastCall().url).toBe('https://idp.test/v2/users/user-2');
  });

  it('treats a missing user as an answer, not a failure', async () => {
    // Callers ask precisely because they do not know whether the id still
    // resolves; a 404 is the answer to that question.
    answers({ message: "User doesn't exist" }, false, 404);

    const user = await Effect.runPromise(management().getUser('gone'));

    expect(user).toBeNull();
  });

  it('still fails on a real outage', async () => {
    answers({ message: 'internal' }, false, 500);

    const error = await Effect.runPromise(
      Effect.flip(management().getUser('x')),
    );

    expect(error._tag).toBe('EntifixConnError');
  });

  it('answers null when the payload carries no user', async () => {
    answers({});

    expect(await Effect.runPromise(management().getUser('x'))).toBeNull();
  });

  it('survives a user with no username', async () => {
    answers({ user: { userId: 'u' } });

    const user = await Effect.runPromise(management().getUser('u'));

    expect(user?.username).toBe('');
    expect(user?.active).toBe(false);
  });
});

describe('createHuman', () => {
  it('creates a verified human with a password', async () => {
    answers({ userId: 'new-user' });

    const userId = await Effect.runPromise(
      management().createHuman({
        username: 'grace@example.com',
        email: 'grace@example.com',
        emailVerified: true,
        givenName: 'Grace',
        familyName: 'Hopper',
        displayName: 'Grace Hopper',
        password: 'Password1!',
      }),
    );

    expect(userId).toBe('new-user');
    expect(lastCall().body).toEqual({
      username: 'grace@example.com',
      profile: {
        givenName: 'Grace',
        familyName: 'Hopper',
        displayName: 'Grace Hopper',
      },
      email: { email: 'grace@example.com', isVerified: true },
      password: { password: 'Password1!', changeRequired: false },
    });
  });

  it('omits the password block entirely when there is none', async () => {
    // A user who will only ever arrive through a social provider must not be
    // given an empty password, which Zitadel would reject as invalid.
    answers({ userId: 'new-user' });

    await Effect.runPromise(
      management().createHuman({
        username: 'social@example.com',
        email: 'social@example.com',
        givenName: 'Soc',
        familyName: 'Ial',
      }),
    );

    const body = lastCall().body;
    expect(body.password).toBeUndefined();
    expect(body.profile.displayName).toBeUndefined();
    expect(body.email.isVerified).toBe(false);
  });

  it('fails when the id is missing from an otherwise successful answer', async () => {
    answers({});

    const error = await Effect.runPromise(
      Effect.flip(
        management().createHuman({
          username: 'u',
          email: 'u@x.io',
          givenName: 'U',
          familyName: 'X',
        }),
      ),
    );

    expect(error.message).toContain('no id');
  });

  it('surfaces the provider s message on a rejection', async () => {
    answers({ message: 'Errors.User.AlreadyExists' }, false, 409);

    const error = await Effect.runPromise(
      Effect.flip(
        management().createHuman({
          username: 'u',
          email: 'u@x.io',
          givenName: 'U',
          familyName: 'X',
        }),
      ),
    );

    expect(error.message).toContain('AlreadyExists');
  });
});

describe('updateProfile', () => {
  it('writes the profile back to the system that owns it', async () => {
    // Zitadel is the writer for these fields; r10c only projects them. An admin
    // edit therefore travels outward before it is ever read back.
    answers({});

    await Effect.runPromise(
      management().updateProfile('user-2', {
        givenName: 'Alan',
        familyName: 'Turing',
        displayName: 'A. Turing',
      }),
    );

    const call = lastCall();
    expect(call.method).toBe('PUT');
    expect(call.url).toBe('https://idp.test/v2/users/human/user-2');
    expect(call.body.profile.displayName).toBe('A. Turing');
  });
});

describe('setActive', () => {
  it.each([
    [true, 'reactivate'],
    [false, 'deactivate'],
  ])('routes %s to /%s', async (active, path) => {
    answers({});

    await Effect.runPromise(management().setActive('user-3', active));

    expect(lastCall().url).toBe(`https://idp.test/v2/users/user-3/${path}`);
  });

  it('fails loudly when the provider refuses', async () => {
    // Suspending an account is a security action; a silently-ignored failure
    // would leave someone able to sign in after being locked out.
    answers({ message: 'nope' }, false, 403);

    const error = await Effect.runPromise(
      Effect.flip(management().setActive('user-3', false)),
    );

    expect(error._tag).toBe('EntifixConnError');
  });
});

describe('deleteUser', () => {
  it('removes the account', async () => {
    answers({});

    await Effect.runPromise(management().deleteUser('user-4'));

    const call = lastCall();
    expect(call.method).toBe('DELETE');
    expect(call.url).toBe('https://idp.test/v2/users/user-4');
  });
});

describe('ZitadelManagementLayer', () => {
  it('binds the tag a composition root asks for', async () => {
    // The seam auth-service wires: a missing binding must be a compile error
    // rather than a runtime surprise inside a sign-in.
    answers({ result: [] });

    const resolved = await Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* ZitadelManagementTag;
        return yield* client.findUserByEmail('a@example.com');
      }).pipe(Effect.provide(ZitadelManagementLayer(config))),
    );

    expect(resolved).toBeNull();
  });
});

describe('transport failures', () => {
  it('wraps a network error rather than leaking it', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    const error = await Effect.runPromise(
      Effect.flip(management().findUserByEmail('a@example.com')),
    );

    expect(error._tag).toBe('EntifixConnError');
    expect(error.message).toContain('ECONNREFUSED');
  });

  it('names the call when the provider explains nothing', async () => {
    answers({}, false, 502);

    const error = await Effect.runPromise(
      Effect.flip(management().deleteUser('user-6')),
    );

    expect(error.message).toContain('502');
    expect(error.message).toContain('/v2/users/user-6');
  });

  it('handles an empty body', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(''),
    });

    await Effect.runPromise(management().deleteUser('user-5'));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
