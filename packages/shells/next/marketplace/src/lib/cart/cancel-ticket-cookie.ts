import { cookies } from 'next/headers';

import {
  CANCEL_COOKIE,
  type CancelTicket,
  parseCancelTicket,
} from './cancel-ticket';

/** The cancellation this browser is waiting on, from its `httpOnly` cookie. */
export const readCancelTicket = async (): Promise<CancelTicket | undefined> =>
  parseCancelTicket((await cookies()).get(CANCEL_COOKIE)?.value);
