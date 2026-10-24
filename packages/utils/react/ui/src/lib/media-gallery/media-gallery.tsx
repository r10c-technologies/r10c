import { useId } from 'react';

import type { ProductCardMedia } from '../product-card/product-card.js';

export interface MediaGalleryProps {
  /** The gallery's name, already translated ("Imágenes del producto"). */
  readonly label: string;
  /** The pictures, in the vendor's order. The first is the main one. */
  readonly items: readonly ProductCardMedia[];
}

/**
 * A product's pictures: a main image, and a thumbnail link for each picture.
 *
 * It runs no script. The pictures sit in one horizontal strip that snaps to
 * one picture at a time, and each thumbnail is an `<a href="#…">` to its
 * picture, so following it scrolls the strip there. Swiping works on touch for
 * the same reason. With a single picture there are no thumbnails, and with
 * none the gallery renders nothing: the page decides what an offering without
 * pictures shows.
 *
 * Every picture carries the vendor's own `alt`, which the save refuses to leave
 * empty. A thumbnail's link is named by its picture, so a screen reader hears
 * the same description in both places.
 */
export function MediaGallery({ label, items }: MediaGalleryProps) {
  const base = useId();
  if (items.length === 0) return null;
  const slideId = (index: number) => `${base}-${index}`;

  return (
    <section aria-label={label} className="flex flex-col gap-2xs">
      <div className="flex aspect-square snap-x snap-mandatory overflow-x-auto scroll-smooth rounded-xl">
        {items.map((item, index) => (
          <img
            key={item.url}
            id={slideId(index)}
            className="h-full w-full shrink-0 snap-center object-cover"
            src={item.url}
            alt={item.alt}
            // The first picture is what the page is about; the rest wait.
            loading={index === 0 ? 'eager' : 'lazy'}
            decoding="async"
          />
        ))}
      </div>
      {items.length > 1 ? (
        <ul className="flex gap-2xs">
          {items.map((item, index) => (
            <li key={item.url}>
              <a
                href={`#${slideId(index)}`}
                className="block size-16 overflow-hidden rounded-md border border-border hover:border-primary"
              >
                <img
                  className="h-full w-full object-cover"
                  src={item.url}
                  alt={item.alt}
                  loading="lazy"
                  decoding="async"
                />
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
