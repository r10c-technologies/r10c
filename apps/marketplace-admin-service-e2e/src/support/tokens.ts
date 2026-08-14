import {
  AUTH_TOKEN_AUDIENCE,
  AUTH_TOKEN_ISSUER,
} from '@r10c/business-ts-authn';
import type { Role } from '@r10c/business-ts-authz';
import type { PartyRoleName } from '@r10c/business-ts-party-management';
import { signAccessToken } from '@r10c/entifix-ts-jwt-client';
// From the package root, not `/playwright`: that subpath pulls in Playwright,
// which has no business loading inside a vitest service suite.
import { isMockProfile } from '@r10c/entifix-ts-testing-e2e';
import {
  E2E_KEY_ID,
  E2E_PRIVATE_KEY_PEM,
  E2E_PUBLIC_KEY_PEM,
} from '@r10c/entifix-ts-testing-e2e/fixtures';

/**
 * The key pair a spec signs tokens with.
 *
 * `mock` uses the suite's own pair — the same one the mock composition root
 * verifies with. `live` needs the real deployment's private key, which a spec
 * has no business holding by default, so it must be supplied through the
 * environment; there is deliberately no fallback that would let a live run
 * silently sign with a test key and fail as "unauthorized" instead of "you did
 * not configure this".
 */
const signingKeys = (): { privateKeyPem: string; publicKeyPem: string } => {
  if (isMockProfile()) {
    return {
      privateKeyPem: E2E_PRIVATE_KEY_PEM,
      publicKeyPem: E2E_PUBLIC_KEY_PEM,
    };
  }
  const privateKeyPem = process.env['JWT_PRIVATE_KEY'];
  const publicKeyPem = process.env['JWT_PUBLIC_KEY'];
  if (privateKeyPem === undefined || publicKeyPem === undefined) {
    throw new Error(
      'A live run must supply JWT_PRIVATE_KEY and JWT_PUBLIC_KEY — the keys config-service holds for the deployment under test',
    );
  }
  return { privateKeyPem, publicKeyPem };
};

const keyId = (): string => process.env['JWT_KEY_ID'] ?? E2E_KEY_ID;

/**
 * The organization a spec token acts for.
 *
 * The catalog is tenant plane, so every catalog route resolves its storage from
 * this claim. A token without it is not "an admin with less data" — it gets
 * `409 noActiveOrganization`, which is the correct answer for a caller with
 * no tenant scope and a confusing one to debug from a spec that simply forgot.
 */
export const E2E_ORGANIZATION_ID = 'e2e-organization';

/**
 * A valid access token for a principal carrying `roles`.
 *
 * `activeOrganizationId` takes **`null`**, not `undefined`, to mean "no tenant
 * scope": passing `undefined` to a parameter with a default triggers the
 * default, so an `undefined` sentinel would silently keep the organization and
 * a spec asserting the no-organization path would pass for the wrong reason.
 *
 * `partyRole` defaults to `vendor` because that is what a token carrying an
 * organization means; a spec exercising an operator passes it explicitly.
 */
export const signTokenFor = (
  roles: readonly Role[],
  userId = 'user-1',
  activeOrganizationId: string | null = E2E_ORGANIZATION_ID,
  partyRole: PartyRoleName = 'vendor',
): Promise<string> =>
  signAccessToken(
    {
      userId,
      subject: userId,
      sessionId: 'sess-1',
      roles,
      partyRole,
      ...(activeOrganizationId === null ? {} : { activeOrganizationId }),
    },
    {
      ...signingKeys(),
      keyId: keyId(),
      issuer: AUTH_TOKEN_ISSUER,
      audience: AUTH_TOKEN_AUDIENCE,
    },
    900,
  );

/** `Authorization` header value for a principal carrying `roles`. */
export const bearerFor = async (roles: readonly Role[]): Promise<string> =>
  `Bearer ${await signTokenFor(roles)}`;
