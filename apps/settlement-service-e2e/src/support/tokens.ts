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
 * The organization a spec token acts for, and the vendor every seeded record
 * belongs to.
 *
 * ⚠️ **This store is control plane, so the claim resolves no database handle.**
 * It is the *predicate* instead: a vendor session reads the records whose
 * `vendorId` equals it, and a token without it reads nothing at all. That is the
 * opposite of stock-service, where the same claim picks which database a read
 * lands in, and it is why a token with no organization gets an empty page here
 * rather than `409 noActiveOrganization`.
 */
export const E2E_ORGANIZATION_ID =
  process.env['SETTLEMENT_ORGANIZATION_ID'] ??
  (isMockProfile() ? 'e2e-organization' : 'demo-organization');

/** A second vendor, so a scoped read has something to *not* return. */
export const E2E_OTHER_ORGANIZATION_ID = 'e2e-other-organization';

/** The party a spec token is. Settlement matches nothing against it. */
export const E2E_PARTY_ID =
  process.env['SETTLEMENT_PARTY_ID'] ?? 'party-user-2';

/**
 * A valid access token for a principal carrying `roles`.
 *
 * `activeOrganizationId` takes **`null`**, not `undefined`, to mean "no tenant
 * scope": passing `undefined` to a parameter with a default triggers the
 * default, so an `undefined` sentinel would silently keep the organization and
 * a spec asserting the no-organization path would pass for the wrong reason.
 *
 * `partyRole` defaults to `vendor`, which is what a token carrying an
 * organization means — and it is the role the scope narrows. `operator` is the
 * one that reads across vendors, and a spec has to be able to mint both.
 */
export const signTokenFor = (
  roles: readonly Role[],
  userId = 'user-1',
  activeOrganizationId: string | null = E2E_ORGANIZATION_ID,
  partyRole: PartyRoleName = 'vendor',
  partyId: string | null = E2E_PARTY_ID,
): Promise<string> =>
  signAccessToken(
    {
      userId,
      subject: userId,
      sessionId: 'sess-1',
      roles,
      partyRole,
      ...(partyId === null ? {} : { partyId }),
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

/** `Authorization` header value for a vendor principal carrying `roles`. */
export const bearerFor = async (roles: readonly Role[]): Promise<string> =>
  `Bearer ${await signTokenFor(roles)}`;

/** `Authorization` header value for platform staff, who read across vendors. */
export const operatorBearerFor = async (
  roles: readonly Role[],
): Promise<string> =>
  `Bearer ${await signTokenFor(roles, 'user-1', null, 'operator', E2E_PARTY_ID)}`;
