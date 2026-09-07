import { permissionForUseCase } from '@r10c/business-ts-authz';
import { SessionStoreTag } from '@r10c/entifix-ts-business';
import { type EntityId, useCase } from '@r10c/entifix-ts-core';
import { Context, Effect } from 'effect';

import { UserIdentity } from '../../entities/user-identity';

/** Whose sessions to end, and which one to spare. */
export interface SignOutOtherSessionsInput {
  readonly userId: EntityId;
  /** The session making the request. It survives; every other one does not. */
  readonly keepSessionId: string;
}

/** Input tag: the caller's own session, provided per call. */
export class SignOutOtherSessionsInputTag extends Context.Tag(
  'SignOutOtherSessionsInputTag',
)<SignOutOtherSessionsInputTag, SignOutOtherSessionsInput>() {}

/**
 * End every session you hold except the one you are using.
 *
 * The **unbound** sibling of `RevokeUserSessionsUC`, and the pair is what makes
 * ADR 0026's binding axis legible: same domain, same entity, and the binding is
 * what says *whose* sessions. `revoke-sessions` is `binding: 'entity'` — an
 * administrator picks an account and signs that person out, which is incident
 * response. This one is `binding: 'unbound'` — it takes no record and no
 * selection, because the subject is the caller.
 *
 * That is also why it belongs in the command palette rather than on a screen.
 * There is no record to open first, and ADR 0035 maps every `unbound` cell to
 * the palette for exactly this shape of verb.
 *
 * It sends **no** notification, unlike its sibling. Being signed out with no
 * explanation looks like a compromise when somebody else did it; here the person
 * who did it is the person reading, and mailing them about their own click is
 * noise that trains people to ignore the security mail that matters.
 *
 * ⚠️ The grant is held by **every** role (`ROLE_PERMISSIONS`), because ending
 * your own sessions is a control the account owner must always have rather than
 * an administrative capability. A role added later that omits it loses
 * self-service, and `@r10c/slices` will not notice: it only checks that a
 * declared verb is granted somewhere.
 */
@useCase({
  entity: UserIdentity,
  key: 'sign-out-others',
  binding: 'unbound',
  placement: 'context-independent',
  labelKey: 'entity:user-identity.useCases.signOutOthers',
  keywordsKey: 'entity:user-identity.useCases.signOutOthersKeywords',
  confirm: {
    tone: 'destructive',
    messageKey: 'entity:user-identity.useCases.signOutOthersConfirm',
  },
})
export class SignOutOtherSessionsUC {
  static run() {
    return Effect.gen(function* () {
      const { userId, keepSessionId } = yield* SignOutOtherSessionsInputTag;
      const sessions = yield* SessionStoreTag;
      yield* sessions.revokeAllForUserExcept(userId, keepSessionId);
    });
  }
}

/**
 * The permission this use case derives. Import it; never retype the verb — this
 * is the only place the string `sign-out-others` is written outside the grant
 * table, and the source scan checks those two agree.
 */
export const SIGN_OUT_OTHERS = permissionForUseCase(SignOutOtherSessionsUC);
