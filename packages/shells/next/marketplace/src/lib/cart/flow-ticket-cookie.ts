import { cookies } from 'next/headers';

import { FLOW_COOKIE, type FlowTicket, parseFlowTicket } from './flow-ticket';

/** The checkout this browser is waiting on, from its `httpOnly` cookie. */
export const readFlowTicket = async (): Promise<FlowTicket | undefined> =>
  parseFlowTicket((await cookies()).get(FLOW_COOKIE)?.value);
