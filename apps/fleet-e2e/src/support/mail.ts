import { PROFILE } from './profile';

/**
 * The fleet's mail, read back from Mailpit's API. A test that needs a mail's
 * content runs under `it.runIf(MAILBOX !== undefined)`: where there is no
 * mailbox it reports skipped, never green on half its assertions.
 */
export const MAILBOX = PROFILE.mailbox;

const api = (path: string) => {
  if (MAILBOX === undefined)
    throw new Error(
      'this fleet has no mailbox to read: guard the test with MAILBOX',
    );
  return fetch(`${MAILBOX}/api/v1${path}`);
};

/** Mail that mentions `query`, newest first. */
export const mailsFor = async (query: string) =>
  (
    (await (
      await api(`/search?query=${encodeURIComponent(query)}`)
    ).json()) as {
      messages?: { ID: string }[];
    }
  ).messages ?? [];

/** A mail's plain-text body. */
export const mailText = async (id: string) =>
  ((await (await api(`/message/${id}`)).json()) as { Text?: string }).Text ??
  '';
