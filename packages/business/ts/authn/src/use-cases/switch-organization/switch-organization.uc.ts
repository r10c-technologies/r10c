import { permissionForUseCase } from '@entifix/authz';
import { type SessionRecord, SessionStoreTag } from '@entifix/business';
import { type EntityId, useCase } from '@entifix/core';
import { Context, Effect, Schema } from 'effect';

import { UserIdentity } from '../../entities/user-identity';
import { NotAMember } from '../../errors';
import {
  IdTokenStoreTag,
  ProviderSessionIndexTag,
  SessionScopeResolverTag,
} from '../../repository';
import { SESSION_IDLE_TTL_SECONDS } from '../../values';

/** Whose session to move, and where. */
export interface SwitchOrganizationInput {
  readonly userId: EntityId;
  /** The session making the request: it is the one replaced. */
  readonly sessionId: string;
  readonly organizationId: string;
}

/** Input tag: the caller and the organization they picked, provided per call. */
export class SwitchOrganizationInputTag extends Context.Service<
  SwitchOrganizationInputTag,
  SwitchOrganizationInput
>()('SwitchOrganizationInputTag') {}

/** What a switch names: the organization to move to. */
export const SwitchOrganizationPayload = Schema.Struct({
  organizationId: Schema.String,
});

/**
 * The provider's session id an `id_token` names, read from its payload. The
 * token was verified when it was stored, at sign-in; this reads it back, it
 * does not trust it anew.
 */
export const providerSessionOf = (idToken: string): string | undefined => {
  try {
    const segment = (idToken.split('.')[1] ?? '')
      .replaceAll('-', '+')
      .replaceAll('_', '/');
    const payload = JSON.parse(atob(segment)) as { sid?: unknown };
    return typeof payload.sid === 'string' ? payload.sid : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Move the caller's session to another organization they are a member of.
 *
 * A session's scope is resolved once and carried, so `requirePrincipal` stays
 * stateless (ADR 0004); a switch is therefore a **new session** with the new
 * scope, and the old one revoked. Three things carry over, or the switch
 * would be a hole:
 * - **the ceiling.** The new session is opened with what was left of the old
 *   one's absolute lifetime, so switching back and forth never extends it;
 * - **the provider's logout.** The old session's `id_token` moves to the new
 *   one, and the provider's `sid` it names is linked to the new id, so
 *   back-channel logout still ends it (ADR 0017);
 * - **the device**, as a label — but no new-device notice, since nothing new
 *   signed in.
 *
 * The membership is the authority: an organization the caller is no member of
 * answers `NotAMember`, whatever the request named. An operator holds no
 * membership, so there is nothing for them to switch to — their cross-tenant
 * reach is ADR 0012's, not this.
 */
@useCase({
  entity: UserIdentity,
  key: 'switch-organization',
  binding: 'unbound',
  placement: 'context-independent',
  labelKey: 'entity:user-identity.useCases.switchOrganization',
  keywordsKey: 'entity:user-identity.useCases.switchOrganizationKeywords',
  payload: SwitchOrganizationPayload,
  errors: [NotAMember],
})
export class SwitchOrganizationUC {
  static run() {
    return Effect.gen(function* () {
      const { userId, sessionId, organizationId } =
        yield* SwitchOrganizationInputTag;
      const scopes = yield* SessionScopeResolverTag;
      const sessions = yield* SessionStoreTag;

      const scope = yield* scopes.forMembership(String(userId), organizationId);
      if (scope === undefined) return yield* new NotAMember();

      const current: SessionRecord = yield* sessions.read(sessionId);
      const remaining = Math.max(
        1,
        Math.floor((Date.parse(current.absoluteExpiresAt) - Date.now()) / 1000),
      );
      const next = yield* sessions.create(
        {
          userId: current.userId,
          subject: current.subject,
          roles: current.roles,
          attributes: current.attributes,
          activeOrganizationId: scope.organizationId,
          partyRole: scope.partyRole,
          partyId: scope.partyId,
          entitlements: scope.entitlements,
          device: current.device,
        },
        {
          idleTtlSeconds: Math.min(SESSION_IDLE_TTL_SECONDS, remaining),
          absoluteTtlSeconds: remaining,
        },
      );

      const idTokens = yield* IdTokenStoreTag;
      const idToken = yield* idTokens.take(sessionId);
      if (idToken !== undefined) {
        yield* idTokens.remember(next, idToken);
        const providerSessionId = providerSessionOf(idToken);
        if (providerSessionId !== undefined) {
          const providerSessions = yield* ProviderSessionIndexTag;
          yield* providerSessions.link(providerSessionId, next);
        }
      }

      yield* sessions.revoke(sessionId);
      return yield* sessions.read(next);
    });
  }
}

/**
 * The permission this use case derives. Import it; never retype the verb — the
 * source scan in `@r10c/slices` checks this string against the grant table.
 */
export const SWITCH_ORGANIZATION = permissionForUseCase(SwitchOrganizationUC);
