import {
  Card,
  Cluster,
  HeadingThree,
  Money,
  Stack,
  StatusTag,
  Text,
} from '@entifix/react-controls/primitives';
import { type ReactNode, useId } from 'react';

/** One picture, as the snapshot carries it: a URL the vendor authored. */
export interface ProductCardMedia {
  readonly url: string;
  readonly alt: string;
}

export type ProductCardDensity = 'comfortable' | 'compact';

/** A price in minor units (cents), and the locale to read it in. */
export interface ProductCardPrice {
  readonly amount: number;
  /** ISO 4217, e.g. `GTQ`. */
  readonly currency: string;
  readonly locale: string;
}

/** Whether it can be bought, and the words for it, already translated. */
export interface ProductCardAvailability {
  readonly label: string;
  readonly available: boolean;
}

/**
 * A product tile, as **roles** rather than as a product.
 *
 * Every role but `title` and `price` may be absent, and an absent role leaves
 * no gap and no placeholder text, so a card with no brand reads as finished
 * rather than broken. The card knows nothing about an offering: a binding maps
 * one onto these roles, so the same tile renders a catalog entry, a search hit
 * or a fixture.
 *
 * `unitPrice` and `rating` are declared and nothing fills them yet. They are
 * here so that the card's layout already has a place for them.
 *
 * The roles are nodes, already translated by whoever renders the card, with
 * two exceptions that carry a rule rather than copy: the price is an amount
 * entifix's `Money` formats, so every price on the storefront is formatted one
 * way, and availability is a `StatusTag`, so it is never colour alone.
 */
export interface ProductCardProps {
  /** Plain text: it names the card for assistive technology, and clamps at two lines. */
  readonly title: string;
  readonly price: ProductCardPrice;
  readonly brand?: ReactNode;
  readonly description?: ReactNode;
  /** The first picture. Absent, the box keeps its size and shows the title's initial. */
  readonly media?: ProductCardMedia;
  readonly unitPrice?: ReactNode;
  readonly badges?: ReactNode;
  readonly chips?: ReactNode;
  readonly rating?: ReactNode;
  readonly availability?: ProductCardAvailability;
  /** The call to action: a link or a form. The card does not decide which. */
  readonly cta?: ReactNode;
  readonly density?: ProductCardDensity;
}

const GAP: Record<ProductCardDensity, 's' | 'xs'> = {
  comfortable: 's',
  compact: 'xs',
};

/**
 * The media box reserves its aspect ratio with or without a picture, so the
 * grid does not reflow when an image arrives or fails.
 */
function CardMedia({
  media,
  title,
}: {
  readonly media: ProductCardMedia | undefined;
  readonly title: string;
}) {
  const box = 'aspect-video w-full overflow-hidden rounded-xl';
  if (media === undefined) {
    return (
      <div
        className={`${box} flex items-center justify-center bg-primary/10 text-primary`}
        aria-hidden="true"
      >
        <span className="text-step-2 font-semibold">{title.charAt(0)}</span>
      </div>
    );
  }
  return (
    <img
      className={`${box} object-cover`}
      src={media.url}
      alt={media.alt}
      loading="lazy"
      decoding="async"
    />
  );
}

export function ProductCard({
  title,
  price,
  brand,
  description,
  media,
  unitPrice,
  badges,
  chips,
  rating,
  availability,
  cta,
  density = 'comfortable',
}: ProductCardProps) {
  const titleId = useId();
  const gap = GAP[density];

  return (
    <Card
      role="article"
      aria-labelledby={titleId}
      data-density={density}
      className="flex flex-col"
    >
      <Stack gap={gap} className="h-full">
        <div className="relative">
          <CardMedia media={media} title={title} />
          {badges === undefined ? null : (
            <div className="absolute top-2xs left-2xs">{badges}</div>
          )}
        </div>

        <Stack gap="3xs">
          <HeadingThree id={titleId} className="line-clamp-2">
            {title}
          </HeadingThree>
          {brand === undefined ? null : <Text muted>{brand}</Text>}
          {rating === undefined ? null : <div>{rating}</div>}
          {description === undefined ? null : (
            <Text muted lineClamp={2}>
              {description}
            </Text>
          )}
        </Stack>

        {chips === undefined ? null : <Cluster gap="3xs">{chips}</Cluster>}

        {/*
          Stacked, not side by side. Beside the price, availability fit or
          wrapped depending on the digits, so one row of a 16rem grid showed
          both layouts at once.
        */}
        <Stack gap="3xs" className="mt-auto">
          <Text weight="semibold">
            <Money unit="minor" {...price} />
          </Text>
          {unitPrice === undefined ? null : (
            <Text muted step={-1}>
              {unitPrice}
            </Text>
          )}
          {availability === undefined ? null : (
            <span>
              <StatusTag tone={availability.available ? 'success' : 'neutral'}>
                {availability.label}
              </StatusTag>
            </span>
          )}
        </Stack>

        {cta}
      </Stack>
    </Card>
  );
}
