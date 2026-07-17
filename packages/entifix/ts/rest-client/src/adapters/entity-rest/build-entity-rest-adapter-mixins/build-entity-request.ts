import type { EntifixEnvelope } from '@r10c/entifix-ts-core';

import { HttpMethod, HttpRequest } from '../../../clients/types';

export interface BuildEntityRequestOptions {
  method: HttpMethod;
  url: string;
  /**
   * The body, already wrapped as an envelope — every entifix message is one.
   * Omitted for reads and deletes, which carry no payload.
   */
  envelope?: EntifixEnvelope<unknown>;
}

/**
 * Assembles the {@link HttpRequest} the fetch client executes. Centralized so
 * the read and write adapters agree on how a message is framed — notably that a
 * body is always an {@link EntifixEnvelope}, and that the JSON content type is
 * declared only when there is one to declare.
 */
export const buildEntityRequest = ({
  method,
  url,
  envelope,
}: BuildEntityRequestOptions): HttpRequest<EntifixEnvelope<unknown>> => ({
  method,
  url,
  ...(envelope
    ? { headers: { 'Content-Type': 'application/json' }, body: envelope }
    : {}),
});
