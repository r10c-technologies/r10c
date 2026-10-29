import type { DeviceContext } from '@entifix/business';

/** A flow's JSON body as a record; anything else reads as empty. */
export const bodyOf = (payload: unknown): Record<string, unknown> =>
  typeof payload === 'object' && payload !== null
    ? (payload as Record<string, unknown>)
    : {};

export const asString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

/** The optional device struct the `-app` edge parsed for us. */
export const readDevice = (
  body: Record<string, unknown>,
): DeviceContext | undefined => {
  const raw = body['device'];
  if (typeof raw !== 'object' || raw === null) return undefined;
  const entry = raw as Record<string, unknown>;
  const deviceId = asString(entry['deviceId']);
  if (deviceId === undefined) return undefined;
  return {
    deviceId,
    browser: asString(entry['browser']),
    os: asString(entry['os']),
    type: asString(entry['type']),
    ip: asString(entry['ip']),
  };
};
