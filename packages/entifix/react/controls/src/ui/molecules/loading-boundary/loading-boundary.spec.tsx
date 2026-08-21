import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LoadingBoundary } from './loading-boundary';

describe('LoadingBoundary', () => {
  it('renders its children once loading is done', () => {
    render(
      <LoadingBoundary isLoading={false}>
        <p>content</p>
      </LoadingBoundary>,
    );

    expect(screen.getByText('content')).toBeInTheDocument();
    expect(screen.queryByTestId('loading-boundary')).not.toBeInTheDocument();
  });

  it('holds the region with a skeleton while loading', () => {
    render(
      <LoadingBoundary isLoading lines={2}>
        <p>content</p>
      </LoadingBoundary>,
    );

    expect(screen.queryByText('content')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('skeleton')).toHaveLength(2);
    expect(screen.getByTestId('loading-boundary')).toHaveAttribute(
      'aria-busy',
      'true',
    );
  });

  it('renders a single block when asked for no lines', () => {
    render(
      <LoadingBoundary isLoading lines={0}>
        <p>content</p>
      </LoadingBoundary>,
    );

    expect(screen.getAllByTestId('skeleton')).toHaveLength(1);
  });

  it('announces a label, because the skeleton itself is aria-hidden', () => {
    render(
      <LoadingBoundary isLoading label="Cargando">
        <p>content</p>
      </LoadingBoundary>,
    );

    expect(screen.getByRole('status')).toHaveTextContent('Cargando');
  });

  it('takes a caller-supplied fallback over the default skeleton', () => {
    render(
      <LoadingBoundary isLoading fallback={<p>custom</p>} className="p-s">
        <p>content</p>
      </LoadingBoundary>,
    );

    expect(screen.getByText('custom')).toBeInTheDocument();
    expect(screen.queryByTestId('skeleton')).not.toBeInTheDocument();
    expect(screen.getByTestId('loading-boundary')).toHaveClass('p-s');
  });
});
