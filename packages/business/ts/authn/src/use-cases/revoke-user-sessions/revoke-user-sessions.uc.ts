import { permissionForUseCase } from '@r10c/business-ts-authz';
import { SessionStoreTag } from '@r10c/entifix-ts-business';
import { type EntityId, useCase } from '@r10c/entifix-ts-core';
import { Context, Effect } from 'effect';

import { UserIdentity } from '../../entities/user-identity';
import {
  AccountRepositoryTag,
  NotificationKind,
  NotificationPortTag,
} from '../../repository';

/** Whose sessions to end. */
export interface RevokeUserSessionsInput {
  readonly userId: EntityId;
}

/** Input tag: the target account, provided per call. */
export class RevokeUserSessionsInputTag extends Context.Tag(
  'RevokeUserSessionsInputTag',
)<RevokeUserSessionsInputTag, RevokeUserSessionsInput>() {}

/**
 * Tell the owner their sessions were ended for them, because they did not do
 * it: being signed out of every device with no explanation looks exactly like
 * an account compromise, and someone who cannot tell those apart cannot report
 * either.
 *
 * Best-effort, like every other notification — a mail failure must not leave
 * the sessions alive.
 */
const notifyOwner = (userId: EntityId) =>
  Effect.gen(function* () {
    const accounts = yield* AccountRepositoryTag;
    const notifications = yield* NotificationPortTag;
    const to = yield* accounts.findContactAddress(userId);
    // A username-only account has nowhere to send it, which is not an error.
    if (to === null) return;
    yield* notifications.send({
      kind: NotificationKind.SessionsRevoked,
      userId,
      to,
    });
  }).pipe(Effect.catchAll(() => Effect.void));

/**
 * End every session an account holds — an administrator signing somebody out
 * everywhere, which is incident response rather than an edit.
 *
 * It is a named verb rather than a shape of `user-identity:write` because the
 * two are not the same authority: editing a display name and terminating
 * someone's access happen to be reachable from the same screen and should not be
 * reachable by the same grant. Until now it borrowed `user-device:write`, which
 * described the record the sessions are listed against rather than the act.
 *
 * The session store is infrastructure, and this use case is the thin thing that
 * names it — it holds no rule of its own beyond "notify afterwards, and never
 * let the notification fail the revocation".
 */
@useCase({
  entity: UserIdentity,
  key: 'revoke-sessions',
  binding: 'entity',
  placement: 'context-independent',
  labelKey: 'entity:user-identity.useCases.revokeSessions',
  confirm: {
    tone: 'destructive',
    messageKey: 'entity:user-identity.useCases.revokeSessionsConfirm',
  },
})
export class RevokeUserSessionsUC {
  static run() {
    return Effect.gen(function* () {
      const { userId } = yield* RevokeUserSessionsInputTag;
      const sessions = yield* SessionStoreTag;
      yield* sessions.revokeAllForUser(userId);
      yield* notifyOwner(userId);
    });
  }
}

/**
 * The permission this use case derives. Import it; never retype the verb — this
 * is the only place in the repo the string `revoke-sessions` is written outside
 * the grant table, and the source scan checks those two agree.
 */
export const REVOKE_SESSIONS = permissionForUseCase(RevokeUserSessionsUC);
