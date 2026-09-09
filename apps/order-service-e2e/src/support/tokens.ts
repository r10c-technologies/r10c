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
 * Every route in this service is tenant-plane, so this claim is what resolves
 * the `stock_<id>` handle a read lands in. A token without it gets
 * `409 noActiveOrganization` rather than an empty page, which is the correct
 * answer for a caller with no tenant scope and a confusing one to debug from a
 * spec that simply forgot.
 *
 * ⚠️ It appears on an order's **lines**, not on the order: the `order` store is
 * platform plane, so nothing here is scoped by organization. It is kept because
 * a line has to name the vendor that owes it, which is what lets one checkout
 * across several vendors be a single receipt. `ORDER_ORGANIZATION_ID` is how a
 * live run names it; the local fleet seeds `demo-organization`.
 */
export const E2E_ORGANIZATION_ID =
  process.env['ORDER_ORGANIZATION_ID'] ??
  (isMockProfile() ? 'e2e-organization' : 'demo-organization');

/**
 * The party a spec token *is* — what a scoped read matches an order's `buyerId`
 * against.
 *
 * It is a party id, not a user id: an order records the `Individual` who placed
 * it, and the hop from an account to a party exists only in auth-service's
 * store, which is why the claim is minted there and carried rather than looked
 * up here.
 */
export const E2E_PARTY_ID =
  process.env['ORDER_PARTY_ID'] ?? 'party-user-2';

/**
 * The crossing secret `POST /api/product-order` expects.
 *
 * A literal under `mock`, matching what the mock composition root provides; a
 * live run reads the deployment's own `service.token` row out of the
 * environment. It is **not** the fleet's `CONFIG_SERVICE_TOKEN` — that one gates
 * a configuration read, this one a tenant-data write for any organization the
 * caller names (ADR 0023).
 */
export const E2E_CROSSING_TOKEN =
  process.env['ORDER_CROSSING_TOKEN'] ?? 'e2e-crossing-token';

/**
 * A valid access token for a principal carrying `roles`.
 *
 * `activeOrganizationId` takes **`null`**, not `undefined`, to mean "no tenant
 * scope": passing `undefined` to a parameter with a default triggers the
 * default, so an `undefined` sentinel would silently keep the organization and
 * a spec asserting the no-organization path would pass for the wrong reason.
 *
 * `partyRole` defaults to `vendor` because that is what a token carrying an
 * organization means — and stock is a vendor's own position, which no other
 * party role has a reason to hold.
 *
 * `partyId` takes `null` for the same reason `activeOrganizationId` does. It is
 * what a read scoped to the caller matches an order's `buyerId` against, so a
 * spec asserting the no-party path has to be able to mint a token without one.
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

/** `Authorization` header value for a principal carrying `roles`. */
export const bearerFor = async (roles: readonly Role[]): Promise<string> =>
  `Bearer ${await signTokenFor(roles)}`;
