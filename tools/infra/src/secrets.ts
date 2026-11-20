/**
 * Every secret the fleet holds, who supplies each, and how a missing one is
 * minted (#683, ADR 0083 §7). The same three lists are `infra/gcp/secrets.tf`'s
 * containers, and the spec fails when the two disagree.
 */
import { generateKeyPairSync, randomBytes } from 'node:crypto';

/** One Atlas database user each (ADR 0083 §4): every service with a `mongo.uri` row. */
export const MONGO_SERVICES = [
  'auth-service',
  'marketplace-service',
  'marketplace-admin-service',
  'order-service',
  'payment-service',
  'settlement-service',
  'stock-service',
  'sales-service',
  'fulfilment-service',
  'realtime-service',
] as const;

/** The Postgres users the fleet connects as, beside Zitadel's own. */
export const SQL_USERS = ['config-service', 'transaction-service'] as const;

export const mongoPasswordOf = (service: string): string =>
  `mongo-${service}-password`;
export const sqlPasswordOf = (user: string): string => `sql-${user}-password`;

/** Minted by the up command the first time it finds the container empty. */
export const GENERATED_SECRETS = [
  'fleet-token',
  'jwt-private-key',
  'flow-crossing-token',
  'stock-crossing-token',
  'order-crossing-token',
  'payment-crossing-token',
  'fulfilment-crossing-token',
  'storefront-lookup-token',
  'redis-password',
  'sql-postgres-password',
  ...SQL_USERS.map(sqlPasswordOf),
  'sql-zitadel-password',
  'zitadel-masterkey',
  'zitadel-admin-password',
  ...MONGO_SERVICES.map(mongoPasswordOf),
] as const;

/** Written by Zitadel at its first init, and kept so the next up reuses them. */
export const MINTED_SECRETS = [
  'zitadel-client-id',
  'zitadel-pat',
  'zitadel-login-pat',
  'zitadel-action-signing-key',
] as const;

/**
 * Accounts a person opens and pastes in (the runbook, #693). Each is a JSON
 * object; `posthog` may be `{}`, which leaves analytics off.
 */
export const PROVIDED_SECRETS = ['grafana-cloud', 'posthog', 'smtp'] as const;

export interface GrafanaCloud {
  readonly endpoint: string;
  readonly instanceId: string;
  readonly token: string;
}

export interface PostHog {
  readonly key?: string;
  readonly host?: string;
}

export interface Smtp {
  readonly host: string;
  readonly port: string;
  readonly user: string;
  readonly password: string;
  readonly from: string;
  readonly tls: boolean;
}

/** A token or a password: 32 random bytes, URL-safe so it fits in a URI unescaped. */
const token = (): string => randomBytes(32).toString('base64url');

/**
 * A missing generated value. Zitadel's master key is exactly 32 characters;
 * its first admin's password has to satisfy the default complexity policy,
 * which a random URL-safe string does not always.
 */
export const mint = (name: string): string => {
  if (name === 'jwt-private-key')
    return generateKeyPairSync('rsa', { modulusLength: 2048 })
      .privateKey.export({ type: 'pkcs8', format: 'pem' })
      .toString();
  if (name === 'zitadel-masterkey')
    return randomBytes(24).toString('base64url').slice(0, 32);
  if (name === 'zitadel-admin-password') return `${token()}Aa1!`;
  return token();
};
