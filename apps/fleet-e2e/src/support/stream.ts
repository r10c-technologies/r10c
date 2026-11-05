import { FLEET, sleep } from './lab';

/** One server-sent frame, with when it arrived. */
export interface Frame {
  readonly at: number;
  readonly event?: string;
  readonly data?: string;
  readonly id?: string;
  readonly retry?: number;
  readonly comment?: string;
}

export interface Stream {
  readonly label: string;
  /** The opening response's status. */
  readonly status: number;
  readonly frames: Frame[];
  /** Resolves once the server closed the stream, or `close()` was called. */
  readonly ended: Promise<void>;
  until(
    holds: (frames: readonly Frame[]) => boolean,
    ms?: number,
  ): Promise<boolean>;
  close(): void;
}

const parse = (block: string, at: number): Frame => {
  const frame: {
    at: number;
    event?: string;
    data?: string;
    id?: string;
    retry?: number;
    comment?: string;
  } = { at };
  for (const line of block.split('\n')) {
    if (line.startsWith(':')) {
      frame.comment = line.slice(1).trim();
      continue;
    }
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') frame.event = value;
    else if (field === 'data')
      frame.data = frame.data === undefined ? value : `${frame.data}\n${value}`;
    else if (field === 'id') frame.id = value;
    else if (field === 'retry') frame.retry = Number(value);
  }
  return frame;
};

/**
 * Opens `GET /api/realtime/stream` through the edge, as a browser's
 * `EventSource` would, and records every frame with its arrival time — the
 * timing is what the reauth and reconnect assertions read.
 */
export const openStream = async (
  label: string,
  auth: {
    bearer?: string;
    capabilities?: readonly string[];
    /** What the stream listens to: `entity:<key>` or `flow:<id>`. */
    topics: readonly string[];
  },
  base: string = FLEET.edge,
): Promise<Stream> => {
  const controller = new AbortController();
  const query = [
    ...auth.topics.map(topic => `topic=${encodeURIComponent(topic)}`),
    ...(auth.capabilities ?? []).map(nonce => `capability=${nonce}`),
  ].join('&');
  const response = await fetch(
    `${base}/api/realtime/stream${query === '' ? '' : `?${query}`}`,
    {
      headers: {
        accept: 'text/event-stream',
        ...(auth.bearer === undefined ? {} : { authorization: auth.bearer }),
      },
      signal: controller.signal,
    },
  );
  const frames: Frame[] = [];
  const reader =
    response.status === 200 ? response.body?.getReader() : undefined;
  const decoder = new TextDecoder();
  let buffer = '';
  const ended = (async () => {
    if (reader === undefined) return;
    for (;;) {
      const chunk = await reader.read().catch(() => undefined);
      if (chunk === undefined || chunk.done) return;
      buffer += decoder
        .decode(chunk.value, { stream: true })
        .replace(/\r\n?/g, '\n');
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (block.trim() !== '') frames.push(parse(block, Date.now()));
        boundary = buffer.indexOf('\n\n');
      }
    }
  })();
  const stream: Stream = {
    label,
    status: response.status,
    frames,
    ended,
    until: async (holds, ms = 10_000) => {
      const deadline = Date.now() + ms;
      while (!holds(frames) && Date.now() < deadline) await sleep(25);
      return holds(frames);
    },
    close: () => {
      controller.abort();
    },
  };
  return stream;
};

/** The JSON payloads of a stream's data frames, by event name. */
export const payloads = (stream: Stream, event?: string) =>
  stream.frames
    .filter(frame => frame.data !== undefined)
    .filter(frame => event === undefined || frame.event === event)
    .map(frame => {
      try {
        return {
          event: frame.event,
          body: JSON.parse(frame.data ?? '') as unknown,
        };
      } catch {
        return { event: frame.event, body: frame.data as unknown };
      }
    });
