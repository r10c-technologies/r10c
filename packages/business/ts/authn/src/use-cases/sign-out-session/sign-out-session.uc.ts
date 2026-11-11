import { permissionForUseCase } from '@entifix/authz';
import { SessionStoreTag } from '@entifix/business';
import { type EntityId, NotFound, useCase } from '@entifix/core';
import { Context, Effect } from 'effect';

import { UserDevice } from '../../entities/user-device';

/** Which session to end, and on whose behalf. */
export interface SignOutSessionInput {
  /** The caller. A session of anybody else's is refused as absent. */
  readonly userId: EntityId;
  readonly sessionId: string;
  /** The session making the request — ending it is signing out. */
  readonly currentSessionId: string;
}

/** Input tag: the caller and the session they picked, provided per call. */
export class SignOutSessionInputTag extends Context.Service<
  SignOutSessionInputTag,
  SignOutSessionInput
>()('SignOutSessionInputTag') {}

/**
 * End one of your own sessions — the row on the sessions screen.
 *
 * Declared on `UserDevice` rather than `UserIdentity` because a session is
 * listed against the device it was opened on, and because of where the cell
 * puts it: `entity` + `context-dependent` is a row's menu. On `UserIdentity`
 * that row is the user list, where "end this session" would name nothing; on
 * `unbound` it would be a command-palette entry with no session to end. No
 * screen lists `UserDevice` rows, so the verb renders exactly where the
 * sessions screen places it. A device can hold several sessions, which is why
 * the target is the session id in the input and never the device's.
 *
 * ⚠️ **The ownership check is the point.** The store revokes any id it is
 * handed, so an id that leaked into a log would otherwise be a remote-logout
 * weapon. Somebody else's session answers exactly as an absent one does —
 * `NotFound`, never a refusal that would confirm a guessed id.
 *
 * Granted to every role, like `sign-out-others`: ending your own session is a
 * control the account owner must always have.
 */
@useCase({
  entity: UserDevice,
  key: 'sign-out-session',
  binding: 'entity',
  placement: 'context-dependent',
  labelKey: 'entity:user-device.useCases.signOutSession',
  confirm: {
    tone: 'destructive',
    messageKey: 'entity:user-device.useCases.signOutSessionConfirm',
  },
  // A revoked session is gone: its holder has to sign in again.
  reversible: 'confirm',
  rowInline: true,
})
export class SignOutSessionUC {
  static run() {
    return Effect.gen(function* () {
      const { userId, sessionId, currentSessionId } =
        yield* SignOutSessionInputTag;
      const sessions = yield* SessionStoreTag;
      const record = yield* sessions.read(sessionId);
      if (String(record.userId) !== String(userId)) {
        return yield* new NotFound({ entity: 'session' });
      }
      yield* sessions.revoke(sessionId);
      return { signedOut: sessionId === currentSessionId };
    });
  }
}

/**
 * The permission this use case derives. Import it; never retype the verb — the
 * source scan in `@r10c/slices` checks this string against the grant table.
 */
export const SIGN_OUT_SESSION = permissionForUseCase(SignOutSessionUC);
