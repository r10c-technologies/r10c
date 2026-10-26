import {
  type DeviceContext,
  SessionStoreTag,
  TokenServiceTag,
} from '@entifix/business';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  AccountRepositoryTag,
  type AuthSubject,
  DEFAULT_SESSION_LIFETIME,
  NotificationKind,
  NotificationPortTag,
  type Principal,
  SessionScopeResolverTag,
  UserDeviceRepositoryTag,
} from '@r10c/business-ts-authn';
import { Effect } from 'effect';

/** The JSON an authenticated flow returns; the Next app turns it into cookies. */
export interface AuthResult {
  readonly accessToken: string;
  readonly sessionId: string;
  /** Seconds the ACCESS TOKEN is valid for — not the session. */
  readonly expiresIn: number;
  /**
   * Seconds until the session's absolute ceiling. The app sizes its cookies
   * against this rather than {@link AuthResult.expiresIn}: a cookie that dies
   * with the token makes an expired token indistinguishable from no session at
   * all, which is what used to sign everyone out every fifteen minutes.
   */
  readonly sessionExpiresIn: number;
  readonly principal: Principal;
}

/**
 * Turn a credential-verified {@link AuthSubject} into a live session + access
 * token. The session lands in the session store (the revocation handle); the
 * token carries only the small, stable claims a downstream authorization
 * check needs.
 *
 * The device rides on the session for display, and is separately remembered
 * so "have I seen this browser before?" survives the session expiring. It is a
 * label throughout: nothing here consults it to decide anything.
 */
export const establishSession = (
  subject: AuthSubject,
  device?: DeviceContext,
): Effect.Effect<
  AuthResult,
  never,
  | AccountRepositoryTag
  | SessionScopeResolverTag
  | NotificationPortTag
  | SessionStoreTag
  | TokenServiceTag
  | UserDeviceRepositoryTag
> =>
  Effect.gen(function* () {
    const sessions = yield* SessionStoreTag;
    const tokens = yield* TokenServiceTag;

    if (device !== undefined) {
      const devices = yield* UserDeviceRepositoryTag;
      const notifications = yield* NotificationPortTag;
      const accounts = yield* AccountRepositoryTag;
      // Best-effort throughout: neither a device-history write nor a
      // notification may cost someone their sign-in. They are labels and
      // warnings; the session is the thing that matters.
      yield* devices.remember(subject.userId, device).pipe(
        Effect.flatMap(remembered =>
          // Only on FIRST sight. Announcing a familiar browser every time is
          // how a security alert becomes noise the owner filters out.
          remembered.isNew
            ? accounts.findContactAddress(subject.userId).pipe(
                Effect.flatMap(to =>
                  // No contact address means nowhere to send it — a
                  // username-only account is not an error.
                  to === null
                    ? Effect.void
                    : notifications.send({
                        kind: NotificationKind.NewDevice,
                        userId: subject.userId,
                        to,
                        data: {
                          browser: device.browser ?? 'unknown',
                          os: device.os ?? 'unknown',
                          ip: device.ip ?? 'unknown',
                        },
                      }),
                ),
              )
            : Effect.void,
        ),
        Effect.catch(() => Effect.void),
      );
    }

    // What this session may reach: which population the party belongs to, and
    // which organization it acts for. Resolved once, at sign-in, and then
    // carried by the session — so `requirePrincipal` stays stateless and no
    // service re-reads a membership on the hot path. A missing organization is
    // a normal answer: a buyer or an operator holds no tenant scope, and
    // `partyRole` is what tells those two apart.
    const scopes = yield* SessionScopeResolverTag;
    const {
      organizationId: activeOrganizationId,
      partyRole,
      partyId,
      entitlements,
    } = yield* scopes.forUser(String(subject.userId));

    const sessionId = yield* sessions.create(
      {
        ...subject,
        activeOrganizationId,
        partyRole,
        partyId,
        entitlements,
        device,
      },
      DEFAULT_SESSION_LIFETIME,
    );
    const accessToken = yield* tokens.sign(
      {
        userId: subject.userId,
        subject: subject.subject,
        sessionId,
        roles: subject.roles,
        activeOrganizationId,
        partyRole,
        partyId,
        entitlements,
      },
      ACCESS_TOKEN_TTL_SECONDS,
    );

    return {
      accessToken,
      sessionId,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      sessionExpiresIn: DEFAULT_SESSION_LIFETIME.absoluteTtlSeconds,
      principal: {
        ...subject,
        organizationId: activeOrganizationId,
        partyRole,
        partyId,
        sessionId,
      },
    };
  }).pipe(Effect.orDie);
