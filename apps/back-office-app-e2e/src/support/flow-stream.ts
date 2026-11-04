import type { NetworkFixture } from '@entifix/testing-e2e/playwright';
import { http, HttpResponse } from 'msw';

import { idleStream, STREAM_URL } from './fixtures';

/**
 * Scripting a flow the back office follows (ADR 0073): the `202` a write
 * handed to a flow answers, and the push stream's frames that settle it. The
 * browser half — the writer, the pending-flow store, the push channel — runs
 * for real; only what the coordinator and the realtime slice would say is
 * chosen here.
 */

/** The `202` a write handed to `flowId` answers, links and all. */
export const flowAccepted = (flowId: string) => () =>
  HttpResponse.json(
    {
      meta: { type: 'flowAccepted' },
      data: {
        flowId,
        links: [
          { rel: 'status', href: `/api/realtime/flow/${flowId}` },
          { rel: 'stream', href: '/api/realtime/stream' },
        ],
      },
    },
    { status: 202 },
  );

/**
 * What settles a pending write: the flow's end, or — for a flow that parks past
 * its commit point, a delivery waiting days for its courier — `flow.waiting`.
 */
export type FlowEnd = 'flow.completed' | 'flow.failed' | 'flow.waiting';

/** One `flow.*` frame for `flowId`, as the realtime slice pushes it. */
export const flowFrame = (
  flowId: string,
  name: FlowEnd,
  failure: { readonly code: string; readonly category: string } = {
    code: 'declined',
    category: 'declined',
  },
) => {
  const event = {
    name,
    id: `${flowId}:${name}:end`,
    source: 'transaction',
    at: new Date().toISOString(),
    correlationId: flowId,
    aggregate: { type: 'flow', id: flowId },
    version: 3,
    audience: [{ kind: 'organization', id: 'e2e-organization' }],
  };
  const data = {
    flowId,
    definition: 'spec',
    slipVersion: 2,
    ...(name === 'flow.failed' ? { failure } : {}),
  };
  return `id: ${event.id}\ndata: ${JSON.stringify({
    topics: [`flow:${flowId}`],
    envelope: { meta: { type: 'event', event }, data },
  })}\n\n`;
};

/**
 * The stream, scripted for `flowId`: idle until the spec sets an outcome, then
 * that outcome twice — as a broker redelivery would send it, so a settlement
 * must act on it once. A short `retry:` makes the browser reopen soon after
 * the flow is added and its topic joins the stream.
 */
export const scriptStream = (
  network: NetworkFixture,
  flowId: string,
  { retryMs = 150 } = {},
) => {
  const script: { outcome?: FlowEnd } = {};
  network.use(
    http.get(STREAM_URL, ({ request }) => {
      const topics = new URL(request.url).searchParams.getAll('topic');
      if (!topics.includes(`flow:${flowId}`)) return idleStream();
      const frames =
        script.outcome === undefined
          ? ''
          : flowFrame(flowId, script.outcome).repeat(2);
      return new HttpResponse(
        `retry: ${String(retryMs)}\n: open\n\n${frames}`,
        { headers: { 'content-type': 'text/event-stream' } },
      );
    }),
  );
  return script;
};
