import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { Align, Justify, SpacingToken } from '../_shared';
import { Cluster } from './cluster.js';

const classesOf = () => screen.getByTestId('cluster').className.split(/\s+/);

describe('Cluster', () => {
  it('wraps with small gap, start justify and center align by default', () => {
    render(<Cluster data-testid="cluster" />);
    expect(classesOf()).toEqual(
      expect.arrayContaining([
        'flex',
        'flex-wrap',
        'gap-s',
        'justify-start',
        'items-center',
      ]),
    );
  });

  it.each(['3xs', 'xs', 'm', 'xl', '3xl'] as SpacingToken[])(
    'maps the %s gap token',
    gap => {
      render(<Cluster data-testid="cluster" gap={gap} />);
      expect(classesOf()).toContain(`gap-${gap}`);
    },
  );

  it.each([
    ['start', 'justify-start'],
    ['center', 'justify-center'],
    ['end', 'justify-end'],
    ['between', 'justify-between'],
  ] as [Justify, string][])('maps the %s justify', (justify, cls) => {
    render(<Cluster data-testid="cluster" justify={justify} />);
    expect(classesOf()).toContain(cls);
  });

  it.each([
    ['start', 'items-start'],
    ['center', 'items-center'],
    ['end', 'items-end'],
    ['stretch', 'items-stretch'],
    ['baseline', 'items-baseline'],
  ] as [Align, string][])('maps the %s align', (align, cls) => {
    render(<Cluster data-testid="cluster" align={align} />);
    expect(classesOf()).toContain(cls);
  });

  it('renders the polymorphic element and keeps caller className', () => {
    render(<Cluster as="ul" data-testid="cluster" className="custom" />);
    expect(screen.getByTestId('cluster').tagName).toBe('UL');
    expect(classesOf()).toContain('custom');
  });
});
