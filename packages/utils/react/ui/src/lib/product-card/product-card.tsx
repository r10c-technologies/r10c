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
  /**
   * Who sells it, already worded ("Vendido por …"). Two vendors can offer the
   * same product under the same name, and without this line their cards read
   * as one card drawn twice.
   */
  readonly seller?: ReactNode;
  readonly description?: ReactNode;
  /** The first picture. Absent, the box keeps its size and shows the title's initial. */
  readonly media?: ProductCardMedia;
  readonly unitPrice?: ReactNode;
  readonly badges?: ReactNode;
  readonly chips?: ReactNode;
  readonly rating?: ReactNode;
  readonly availability?: ProductCardAvailability;
  /**
   * Where the card leads. Given, the title is a link stretched over the whole
   * card, so a tap on the picture or the name opens the product: that is
   * where a phone user taps, and a second "view" button would be a second way
   * to do what the card itself does (#568). Absent (a fixture, a story), the
   * title is plain text.
   */
  readonly href?: string;
  /**
   * The call to action: a link or a form. The card does not decide which. It
   * sits above the stretched title link, so it still takes its own taps and
   * focus.
   */
  readonly cta?: ReactNode;
  readonly density?: ProductCardDensity;
}

const GAP: Record<ProductCardDensity, 's' | 'xs'> = {
  comfortable: 's',
  compact: 'xs',
};

/**
 * The media box reserves its aspect ratio with or without a picture, so the
 * grid does not reflow when an image arrives or fails. A wide card shows it
 * 16:9; a narrow one (two to a row on a phone) shows it square, the shape the
 * snapshot's pictures are, so the card is not mostly letterbox (#568).
 */
function CardMedia({
  media,
  title,
}: {
  readonly media: ProductCardMedia | undefined;
  readonly title: string;
}) {
  const box =
    'aspect-video w-full overflow-hidden rounded-xl @max-[13rem]:aspect-square';
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
  seller,
  description,
  media,
  unitPrice,
  badges,
  chips,
  rating,
  availability,
  href,
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
      // A size container, so the card lays itself out by its own width rather
      // than the viewport's: the same card is narrow in a phone's two columns
      // and wide in a desktop strip. `relative` anchors the title's stretched
      // link.
      className="@container relative flex flex-col"
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
            {href === undefined ? (
              title
            ) : (
              <a
                href={href}
                className="text-content no-underline focus-ring after:absolute after:inset-0 after:content-['']"
              >
                {title}
              </a>
            )}
          </HeadingThree>
          {brand === undefined ? null : <Text muted>{brand}</Text>}
          {seller === undefined ? null : (
            <Text muted data-testid="card-seller">
              {seller}
            </Text>
          )}
          {rating === undefined ? null : <div>{rating}</div>}
          {description === undefined ? null : (
            // Left out of a narrow card: two lines of description at that
            // width are a third of a phone screen per product.
            <Text muted lineClamp={2} className="@max-[13rem]:hidden">
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

        {cta === undefined ? null : <div className="relative z-10">{cta}</div>}
      </Stack>
    </Card>
  );
}
