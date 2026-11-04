import {
  defineEntifixE2eTest,
  type NetworkFixture,
} from '@entifix/testing-e2e/playwright';
import { http, HttpResponse } from 'msw';

/**
 * The browser half of a checkout, stubbed (ADR 0072, ADR 0073).
 *
 * Everything else the storefront reads is fetched by server components and
 * stubbed inside the Next process (`server-mocks.mjs`). Two reads are the
 * browser's own: the push stream the order-status page waits on, and the
 * flow-status catch-up it makes on mount. Under `mock` nothing serves
 * `/api/realtime/*` behind the edge, so both are answered here.
 */
const APP_URL = 'http://localhost:3000';

export const STREAM_URL = `${APP_URL}/api/realtime/stream`;

/** Where a pending flow catches up from; `404` means still pending. */
export const FLOW_STATUS_URL = `${APP_URL}/api/realtime/flow/:id`;

/** An idle stream: the opening frame and a long `retry:`, and no events. */
export const idleStream = () =>
  new HttpResponse('retry: 60000\n: open\n\n', {
    headers: { 'content-type': 'text/event-stream' },
  });

export const stillPending = () =>
  HttpResponse.json(
    { type: 'about:blank', code: 'notFound', status: 404 },
    { status: 404, headers: { 'content-type': 'application/problem+json' } },
  );

export type FlowOutcome = 'flow.completed' | 'flow.failed';

/** One SSE frame carrying `name` for a flow, as realtime-service writes it. */
export const flowFrame = (flowId: string, name: FlowOutcome) => {
  const event = {
    name,
    id: `${flowId}:${name}:end`,
    source: 'transaction',
    at: new Date().toISOString(),
    correlationId: flowId,
    aggregate: { type: 'flow', id: flowId },
    version: 3,
    audience: [{ kind: 'flow', id: flowId }],
  };
  const data = {
    flowId,
    definition: 'checkout',
    slipVersion: 1,
    ...(name === 'flow.failed'
      ? { failure: { code: 'declined', category: 'declined' } }
      : {}),
  };
  return `id: ${event.id}\ndata: ${JSON.stringify({
    topics: [`flow:${flowId}`],
    envelope: { meta: { type: 'event', event }, data },
  })}\n\n`;
};

/**
 * The stream, holding every flow's outcome back until a spec releases it. Each
 * response ends after its frames, so the browser reconnects at the short
 * `retry:` and finds the outcome once it is released. The flow is whichever
 * the stream subscribed to: ids are minted per checkout by the coordinator
 * stub, so a spec cannot know one in advance.
 */
export const scriptStream = (
  network: NetworkFixture,
  { retryMs = 150 } = {},
) => {
  const script: { outcome?: FlowOutcome } = {};
  network.use(
    http.get(STREAM_URL, ({ request }) => {
      const url = new URL(request.url);
      const flows = url.searchParams
        .getAll('topic')
        .filter(topic => topic.startsWith('flow:'))
        .map(topic => topic.slice('flow:'.length));
      // A topic the stream may hear only with the flow's capability beside it.
      if (
        flows.length === 0 ||
        url.searchParams.getAll('capability').length === 0
      ) {
        return idleStream();
      }
      // The outcome twice, as a broker redelivery would send it: the page must
      // settle once.
      const frames =
        script.outcome === undefined
          ? ''
          : flows
              .map(flowId =>
                flowFrame(flowId, script.outcome as FlowOutcome).repeat(2),
              )
              .join('');
      return new HttpResponse(
        `retry: ${String(retryMs)}\n: open\n\n${frames}`,
        {
          headers: { 'content-type': 'text/event-stream' },
        },
      );
    }),
  );
  return script;
};

export const test = defineEntifixE2eTest({
  handlers: [
    http.get(STREAM_URL, idleStream),
    http.get(FLOW_STATUS_URL, stillPending),
  ],
  // The storefront serves its own documents and server actions; the catalog's
  // pictures name an outside host the browser is told does not resolve
  // (`playwright.config.ts`), so they are let through to fail on their own.
  passthroughOrigins: [APP_URL, 'https://picsum.photos'],
});

export { expect } from '@entifix/testing-e2e/playwright';
