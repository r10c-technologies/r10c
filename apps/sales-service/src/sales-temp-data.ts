/**
 * The demo vendor's channels, in the entity wire shape.
 *
 * Wire shape rather than constructed instances, for the reason every other seed
 * in the fleet is: these insert verbatim and read back through the entifix
 * deserializer, so a mistake in a member name fails a read rather than passing
 * silently through a setter.
 *
 * Two channels rather than one. `storefront` is the channel every sale placed
 * before this domain existed implicitly came through, so seeding it is what
 * makes "which channel was this?" answerable for the marketplace path too —
 * and having a second row is what makes a picker with the wrong filter
 * visibly wrong.
 */
export const salesChannelTempData = [
  {
    id: 'sales-channel-storefront',
    name: 'Marketplace',
    type: 'storefront',
    status: 'active',
  },
  {
    id: 'sales-channel-counter',
    name: 'Mostrador principal',
    type: 'counter',
    status: 'active',
  },
] as const;
