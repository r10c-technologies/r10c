'use client';

import {
  Button,
  Card,
  Caption,
  HeadingOne,
  HeadingThree,
  Lead,
  Overline,
  Stack,
  Text,
  ThemeSwitcher,
} from '@r10c/entifix-react-controls';

type Product = {
  name: string;
  blurb: string;
  price: string;
  tag: string;
};

const PRODUCTS: Product[] = [
  {
    name: 'Aurora Desk Lamp',
    blurb: 'Warm dimmable LED with a brushed aluminium arm.',
    price: '$89',
    tag: 'New',
  },
  {
    name: 'Terra Ceramic Mug',
    blurb: 'Hand-glazed stoneware, 350ml, dishwasher safe.',
    price: '$24',
    tag: 'Popular',
  },
  {
    name: 'Nimbus Wool Throw',
    blurb: 'Ethically sourced merino, oversized weave.',
    price: '$140',
    tag: 'Limited',
  },
];

export default function Index() {
  return (
    <main className="mx-auto w-full max-w-5xl px-s py-l sm:px-l sm:py-xl">
      <Stack gap="l">
        {/* Header + theme switcher */}
        <header className="flex flex-col gap-s sm:flex-row sm:items-start sm:justify-between">
          <Stack gap="2xs" className="min-w-0">
            <Overline>Storefront</Overline>
            <HeadingOne>Marketplace</HeadingOne>
            <Lead>
              The same entifix design system as the admin app — driven by this
              app&apos;s own emerald brand palette. Switch light/dark below.
            </Lead>
          </Stack>
          <ThemeSwitcher className="shrink-0" />
        </header>

        {/* Product grid — brand-themed cards */}
        <div className="grid grid-cols-1 gap-l sm:grid-cols-2 lg:grid-cols-3">
          {PRODUCTS.map(product => (
            <Card key={product.name}>
              <Stack gap="s">
                {/* Fake product image using the brand colors */}
                <div className="flex aspect-video items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <span className="text-step-2 font-semibold">
                    {product.name.charAt(0)}
                  </span>
                </div>
                <Stack gap="3xs">
                  <div className="flex items-center justify-between gap-2xs">
                    <HeadingThree>{product.name}</HeadingThree>
                    <span className="rounded-md bg-accent/15 px-2xs py-3xs text-step-xs font-medium text-accent">
                      {product.tag}
                    </span>
                  </div>
                  <Text muted lineClamp={2}>
                    {product.blurb}
                  </Text>
                </Stack>
                <div className="flex items-center justify-between gap-s">
                  <Text weight="semibold" step={1}>
                    {product.price}
                  </Text>
                  <Button variant="primary">Add to cart</Button>
                </div>
              </Stack>
            </Card>
          ))}
        </div>

        {/* Control sampler */}
        <div className="grid grid-cols-1 gap-l lg:grid-cols-2">
          <Card>
            <Stack gap="s">
              <HeadingThree>Buttons</HeadingThree>
              <Text muted>Same atoms, storefront brand.</Text>
              <Stack direction="row" gap="s" align="center" wrap>
                <Button variant="primary">Primary</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="primary" size="lg">
                  Checkout
                </Button>
              </Stack>
            </Stack>
          </Card>

          <Card>
            <Stack gap="2xs">
              <HeadingThree>Typography</HeadingThree>
              <Text>
                Body text scales fluidly with the viewport and follows the
                active palette.
              </Text>
              <Caption>
                Caption — brand colors come from this app&apos;s themes.css.
              </Caption>
            </Stack>
          </Card>
        </div>
      </Stack>
    </main>
  );
}
