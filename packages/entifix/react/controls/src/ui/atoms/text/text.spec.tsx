import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  Blockquote,
  Caption,
  Code,
  Em,
  Heading,
  HeadingFive,
  HeadingFour,
  HeadingOne,
  HeadingSix,
  HeadingThree,
  HeadingTwo,
  Kbd,
  Lead,
  Link,
  List,
  ListItem,
  Overline,
  Small,
  Strong,
  Text,
} from './text.js';

/** The element a component rendered, which is the part screen readers act on. */
const tagOf = (testId: string) => screen.getByTestId(testId).tagName.toLowerCase();

const classesOf = (testId: string) =>
  screen.getByTestId(testId).className.split(/\s+/);

describe('Text', () => {
  it('renders a paragraph at the body step by default', () => {
    render(<Text data-testid="t">Body</Text>);

    expect(tagOf('t')).toBe('p');
    expect(classesOf('t')).toContain('text-step-0');
    expect(classesOf('t')).toContain('text-content');
  });

  it.each([
    [-2, 'text-step-xs'],
    [-1, 'text-step-sm'],
    [0, 'text-step-0'],
    [1, 'text-step-1'],
    [2, 'text-step-2'],
    [3, 'text-step-3'],
  ] as const)('maps step %s onto the fluid scale', (step, expected) => {
    render(
      <Text data-testid="t" step={step}>
        Body
      </Text>,
    );

    expect(classesOf('t')).toContain(expected);
  });

  it.each([
    ['normal', 'font-normal'],
    ['medium', 'font-medium'],
    ['semibold', 'font-semibold'],
    ['bold', 'font-bold'],
  ] as const)('maps weight %s', (weight, expected) => {
    render(
      <Text data-testid="t" weight={weight}>
        Body
      </Text>,
    );

    expect(classesOf('t')).toContain(expected);
  });

  it.each([
    ['default', 'text-content'],
    ['muted', 'text-content-muted'],
    ['primary', 'text-primary'],
    ['accent', 'text-accent'],
  ] as const)('maps tone %s', (tone, expected) => {
    render(
      <Text data-testid="t" tone={tone}>
        Body
      </Text>,
    );

    expect(classesOf('t')).toContain(expected);
  });

  it.each([
    ['start', 'text-left'],
    ['center', 'text-center'],
    ['end', 'text-right'],
  ] as const)('maps align %s', (align, expected) => {
    render(
      <Text data-testid="t" align={align}>
        Body
      </Text>,
    );

    expect(classesOf('t')).toContain(expected);
  });

  // `muted` is the legacy shorthand kept for callers that predate `tone`; it has
  // to win, or a caller passing both silently gets the wrong colour.
  it('lets the muted shorthand override an explicit tone', () => {
    render(
      <Text data-testid="t" tone="primary" muted>
        Body
      </Text>,
    );

    expect(classesOf('t')).toContain('text-content-muted');
    expect(classesOf('t')).not.toContain('text-primary');
  });

  it('truncates to one line on request', () => {
    render(
      <Text data-testid="t" truncate>
        Body
      </Text>,
    );

    expect(classesOf('t')).toContain('truncate');
  });

  it.each([1, 2, 3, 4] as const)('clamps to %s lines', (lines) => {
    render(
      <Text data-testid="t" lineClamp={lines}>
        Body
      </Text>,
    );

    expect(classesOf('t')).toContain(`line-clamp-${lines}`);
  });

  it('renders as another element on request', () => {
    render(
      <Text data-testid="t" as="span">
        Body
      </Text>,
    );

    expect(tagOf('t')).toBe('span');
  });

  it('keeps the caller’s className alongside its own', () => {
    render(
      <Text data-testid="t" className="custom">
        Body
      </Text>,
    );

    expect(classesOf('t')).toEqual(expect.arrayContaining(['text-step-0', 'custom']));
  });
});

describe('the text variants', () => {
  it.each([
    ['Lead', Lead, 'p', 'text-step-1'],
    ['Small', Small, 'small', 'text-step-sm'],
    ['Caption', Caption, 'span', 'text-step-xs'],
    ['Overline', Overline, 'span', 'text-step-xs'],
  ] as const)('%s renders a %s at its own step', (_label, Component, tag, step) => {
    render(<Component data-testid="t">Text</Component>);

    expect(tagOf('t')).toBe(tag);
    expect(classesOf('t')).toContain(step);
  });

  it.each([
    ['Strong', Strong, 'strong'],
    ['Em', Em, 'em'],
    ['Code', Code, 'code'],
    ['Kbd', Kbd, 'kbd'],
    ['Blockquote', Blockquote, 'blockquote'],
    ['ListItem', ListItem, 'li'],
  ] as const)('%s renders a semantic <%s>', (_label, Component, tag) => {
    render(<Component data-testid="t">Text</Component>);

    expect(tagOf('t')).toBe(tag);
  });

  it.each([
    ['Strong', Strong],
    ['Em', Em],
    ['Code', Code],
    ['Kbd', Kbd],
    ['Blockquote', Blockquote],
    ['ListItem', ListItem],
  ] as const)('%s keeps the caller’s className', (_label, Component) => {
    render(
      <Component data-testid="t" className="custom">
        Text
      </Component>,
    );

    expect(classesOf('t')).toContain('custom');
  });
});

describe('Link', () => {
  it('renders an anchor carrying its href and children', () => {
    render(
      <Link data-testid="t" href="/catalog">
        Catalog
      </Link>,
    );

    expect(tagOf('t')).toBe('a');
    expect(screen.getByTestId('t')).toHaveAttribute('href', '/catalog');
    expect(screen.getByTestId('t')).toHaveTextContent('Catalog');
  });

  it('keeps the caller’s className', () => {
    render(
      <Link data-testid="t" href="#" className="custom">
        Catalog
      </Link>,
    );

    expect(classesOf('t')).toContain('custom');
  });
});

describe('List', () => {
  it('renders an unordered list by default', () => {
    render(
      <List data-testid="t">
        <ListItem>One</ListItem>
      </List>,
    );

    expect(tagOf('t')).toBe('ul');
    expect(classesOf('t')).toContain('list-disc');
  });

  // The tag has to change with the marker style, not just the CSS: an ordered
  // list read aloud is announced differently.
  it('renders an ordered list on request', () => {
    render(
      <List data-testid="t" ordered>
        <ListItem>One</ListItem>
      </List>,
    );

    expect(tagOf('t')).toBe('ol');
    expect(classesOf('t')).toContain('list-decimal');
  });

  it('keeps the caller’s className', () => {
    render(<List data-testid="t" className="custom" />);

    expect(classesOf('t')).toContain('custom');
  });
});

describe('the headings', () => {
  it('defaults to an h2 at the largest step', () => {
    render(<Heading data-testid="t">Title</Heading>);

    expect(tagOf('t')).toBe('h2');
    expect(classesOf('t')).toEqual(
      expect.arrayContaining(['text-step-3', 'font-semibold']),
    );
  });

  it('renders as another element and step on request', () => {
    render(
      <Heading data-testid="t" as="h4" step={0} weight="bold">
        Title
      </Heading>,
    );

    expect(tagOf('t')).toBe('h4');
    expect(classesOf('t')).toEqual(
      expect.arrayContaining(['text-step-0', 'font-bold']),
    );
  });

  // The named headings exist so a page's outline is correct by construction;
  // each must render its own level rather than a styled div.
  it.each([
    ['HeadingOne', HeadingOne, 'h1', 'text-step-3'],
    ['HeadingTwo', HeadingTwo, 'h2', 'text-step-2'],
    ['HeadingThree', HeadingThree, 'h3', 'text-step-1'],
    ['HeadingFour', HeadingFour, 'h4', 'text-step-0'],
    ['HeadingFive', HeadingFive, 'h5', 'text-step-0'],
    ['HeadingSix', HeadingSix, 'h6', 'text-step-0'],
  ] as const)('%s renders <%s>', (_label, Component, tag, step) => {
    render(<Component data-testid="t">Title</Component>);

    expect(tagOf('t')).toBe(tag);
    expect(classesOf('t')).toContain(step);
  });

  it('gives HeadingSix its own uppercase treatment', () => {
    render(<HeadingSix data-testid="t">Title</HeadingSix>);

    expect(classesOf('t')).toEqual(expect.arrayContaining(['uppercase', 'tracking-wide']));
  });

  it('keeps the caller’s className on a named heading', () => {
    render(
      <HeadingSix data-testid="t" className="custom">
        Title
      </HeadingSix>,
    );

    expect(classesOf('t')).toContain('custom');
  });
});
