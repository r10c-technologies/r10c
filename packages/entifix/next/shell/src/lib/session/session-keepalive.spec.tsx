import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionKeepalive } from './session-keepalive';
import type { SessionRefreshState } from './use-session-refresh';

const useSessionRefresh = vi.hoisted(() => vi.fn());

// The hook has its own spec covering the schedule, the idle gate and the
// countdown. What is left to this component is what it does with the three
// booleans, so the hook is a double rather than a fetch-and-fake-timers setup
// that would re-prove somebody else's tests.
vi.mock('./use-session-refresh', () => ({ useSessionRefresh }));

const reports = (state: Partial<SessionRefreshState>) => {
  useSessionRefresh.mockReturnValue({
    sessionExpiresIn: undefined,
    expiringSoon: false,
    expired: false,
    ...state,
  });
};

/** `window.location` is read-only in jsdom, so swap it for a plain object. */
const stubReload = () => {
  const reload = vi.fn();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { reload } as unknown as Location,
  });
  return reload;
};

/** Run whatever the component handed the hook as its expiry callback. */
const expire = () => {
  const options = useSessionRefresh.mock.calls.at(-1)?.[0] as {
    onExpired?: () => void;
  };
  options.onExpired?.();
};

beforeEach(() => {
  useSessionRefresh.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SessionKeepalive', () => {
  it('renders nothing while the session is healthy', () => {
    reports({});

    const { container } = render(<SessionKeepalive />);

    expect(container).toBeEmptyDOMElement();
  });

  it('warns once the session is close to its ceiling', () => {
    reports({ expiringSoon: true, sessionExpiresIn: 120 });

    render(<SessionKeepalive />);

    // `status`, not `alert`: the session ending soon is a thing to notice, and
    // an assertive region would talk over whatever the person is doing.
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('stops warning once the session is actually over', () => {
    // Both flags at once is the real sequence — the last state before a refresh
    // fails is the warning — and a strip saying "about to expire" over a page
    // that is already leaving would be the wrong sentence at the wrong moment.
    reports({ expiringSoon: true, expired: true });

    const { container } = render(<SessionKeepalive />);

    expect(container).toBeEmptyDOMElement();
  });

  it('reloads on expiry, letting middleware decide where a signed-out visitor goes', () => {
    // By this point the refresh route has already cleared both cookies, so a
    // reload meets the middleware with no session and gets the redirect — with
    // the right locale and the right `redirect` parameter — for free. Building
    // that URL here would be a second copy of a rule that already exists.
    const reload = stubReload();
    reports({});
    render(<SessionKeepalive />);

    expire();

    expect(reload).toHaveBeenCalledOnce();
  });

  it('lets a host override what expiry does', () => {
    const reload = stubReload();
    const onExpired = vi.fn();
    reports({});
    render(<SessionKeepalive onExpired={onExpired} />);

    expire();

    expect(onExpired).toHaveBeenCalledOnce();
    expect(reload).not.toHaveBeenCalled();
  });

  it('passes the host’s endpoint through to the hook', () => {
    reports({});

    render(<SessionKeepalive endpoint="/api/session/refresh" />);

    expect(useSessionRefresh).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: '/api/session/refresh' }),
    );
  });
});
