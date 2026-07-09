'use client';

import {
  Blockquote,
  Button,
  Caption,
  Card,
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
  type SpacingToken,
  Stack,
  Strong,
  Text,
  ThemeSwitcher,
} from '@r10c/entifix-react-controls';

const SPACING_STEPS: SpacingToken[] = [
  '3xs',
  '2xs',
  'xs',
  's',
  'm',
  'l',
  'xl',
  '2xl',
  '3xl',
];

export default function Index() {
  return (
    <main className="mx-auto w-full max-w-5xl px-s py-l sm:px-l sm:py-xl">
      <Stack gap="l">
        {/* Header + theme switcher — stacks on mobile, row on desktop */}
        <header className="flex flex-col gap-s sm:flex-row sm:items-start sm:justify-between">
          <Stack gap="2xs" className="min-w-0">
            <Heading step={3}>Design System Playground</Heading>
            <Text muted className="max-w-prose">
              Fluid spacing (Utopia), atomic-design composition, and three
              themes including a dark one. Resize — spacing, type, and layout
              respond.
            </Text>
          </Stack>
          <ThemeSwitcher className="shrink-0" />
        </header>

        {/* Responsive grid: 1 column on mobile, 2 on large screens */}
        <div className="grid grid-cols-1 gap-l lg:grid-cols-2">
          {/* Atomic composition: buttons */}
          <Card>
            <Stack gap="s">
              <Heading step={1} as="h2">
                Buttons
              </Heading>
              <Text muted>Atoms composed inside a molecule (Card).</Text>
              <Stack direction="row" gap="s" align="center" wrap>
                <Button variant="primary">Primary</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="primary" size="lg">
                  Large
                </Button>
                <Button variant="primary" size="sm">
                  Small
                </Button>
                <Button variant="primary" disabled>
                  Disabled
                </Button>
              </Stack>
            </Stack>
          </Card>

          {/* Heading components */}
          <Card>
            <Stack gap="2xs">
              <Heading step={1} as="h2">
                Heading components
              </Heading>
              <HeadingOne>HeadingOne</HeadingOne>
              <HeadingTwo>HeadingTwo</HeadingTwo>
              <HeadingThree>HeadingThree</HeadingThree>
              <HeadingFour>HeadingFour</HeadingFour>
              <HeadingFive>HeadingFive</HeadingFive>
              <HeadingSix>HeadingSix</HeadingSix>
            </Stack>
          </Card>

          {/* Text primitives */}
          <Card>
            <Stack gap="s">
              <Heading step={1} as="h2">
                Text &amp; helpers
              </Heading>
              <Overline>Prose primitives</Overline>
              <Lead>
                Lead copy introduces a section with a larger, muted paragraph
                before the body text begins.
              </Lead>
              <Text>
                Body text with inline <Strong>strong</Strong>, <Em>emphasis</Em>
                , a <Link href="#">themed link</Link>, and{' '}
                <Code>inline code</Code>. Press <Kbd>⌘</Kbd> <Kbd>K</Kbd> to
                search.
              </Text>
              <Text muted lineClamp={2}>
                Muted text clamped to two lines — this sentence is intentionally
                long so the ellipsis truncation is visible once the line count
                exceeds the configured clamp value on narrow viewports.
              </Text>
              <List>
                <ListItem>Unordered list item</ListItem>
                <ListItem>Themed markers, fluid gap</ListItem>
              </List>
              <List ordered>
                <ListItem>Ordered list item</ListItem>
                <ListItem>Numeric markers</ListItem>
              </List>
              <Blockquote>
                A pull quote uses a themed left border and muted italic body.
              </Blockquote>
              <Caption>
                Caption — the smallest fluid step, for fine print.
              </Caption>
              <Small>Small helper text sits just below body.</Small>
            </Stack>
          </Card>

          {/* Fluid spacing scale — spans both columns on desktop */}
          <Card className="lg:col-span-2">
            <Stack gap="s">
              <Heading step={1} as="h2">
                Fluid spacing scale
              </Heading>
              <Text muted>
                Each bar is one Utopia step. Widths use the same fluid tokens as
                gaps and padding.
              </Text>
              <Stack gap="2xs">
                {SPACING_STEPS.map(token => (
                  <Stack key={token} direction="row" gap="s" align="center">
                    <Text step={0} className="w-12 shrink-0 font-mono">
                      {token}
                    </Text>
                    <div
                      className="h-4 rounded-md bg-primary transition-all duration-200"
                      style={{ width: `var(--spacing-${token})` }}
                    />
                  </Stack>
                ))}
              </Stack>
            </Stack>
          </Card>
        </div>
      </Stack>
    </main>
  );
}
