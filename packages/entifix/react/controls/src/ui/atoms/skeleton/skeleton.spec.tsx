import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Skeleton, SkeletonText } from './skeleton.js';

describe('Skeleton', () => {
  it('renders a block by default and is hidden from assistive tech', () => {
    render(<Skeleton />);
    const el = screen.getByTestId('skeleton');

    expect(el).toHaveAttribute('aria-hidden', 'true');
    expect(el.className).toContain('rounded-md');
  });

  it('renders a line shape', () => {
    render(<Skeleton shape="line" />);
    expect(screen.getByTestId('skeleton').className).toContain('rounded-full');
  });

  it('renders a circle shape', () => {
    render(<Skeleton shape="circle" />);
    expect(screen.getByTestId('skeleton').className).toContain('aspect-square');
  });

  it('merges caller className and passes through props', () => {
    render(<Skeleton className="h-8 w-8" data-foo="bar" />);
    const el = screen.getByTestId('skeleton');

    expect(el.className).toContain('h-8');
    expect(el).toHaveAttribute('data-foo', 'bar');
  });
});

describe('SkeletonText', () => {
  it('renders three lines by default with a shortened last line', () => {
    render(<SkeletonText />);
    const lines = screen.getAllByTestId('skeleton');

    expect(lines).toHaveLength(3);
    expect(lines[2]?.className).toContain('w-2/3');
    expect(lines[0]?.className).toContain('w-full');
  });

  it('honours an explicit line count', () => {
    render(<SkeletonText lines={5} />);
    expect(screen.getAllByTestId('skeleton')).toHaveLength(5);
  });
});
