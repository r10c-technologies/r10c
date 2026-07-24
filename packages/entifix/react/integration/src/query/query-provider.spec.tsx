import { useQuery } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { EntifixQueryProvider, makeQueryClient } from './query-provider.js';

function Probe() {
  const { data } = useQuery({
    queryKey: ['probe'],
    queryFn: () => Promise.resolve('ready'),
  });
  return <span>{data ?? 'loading'}</span>;
}

describe('EntifixQueryProvider', () => {
  it('provides a client so descendant queries run', async () => {
    render(
      <EntifixQueryProvider>
        <Probe />
      </EntifixQueryProvider>,
    );

    await waitFor(() => expect(screen.getByText('ready')).toBeInTheDocument());
  });

  it('uses an injected client when given one', async () => {
    const client = makeQueryClient();
    render(
      <EntifixQueryProvider client={client}>
        <Probe />
      </EntifixQueryProvider>,
    );

    await waitFor(() => expect(screen.getByText('ready')).toBeInTheDocument());
    expect(client.getQueryData(['probe'])).toBe('ready');
  });
});

describe('makeQueryClient', () => {
  it('defaults queries to no-retry, stale-while-revalidate', () => {
    const { queries } = makeQueryClient().getDefaultOptions();

    expect(queries?.retry).toBe(false);
    expect(queries?.refetchOnWindowFocus).toBe(false);
    expect(queries?.staleTime).toBe(30_000);
  });

  it('lets callers override query defaults', () => {
    const client = makeQueryClient({
      defaultOptions: { queries: { staleTime: 0 } },
    });

    expect(client.getDefaultOptions().queries?.staleTime).toBe(0);
  });
});
