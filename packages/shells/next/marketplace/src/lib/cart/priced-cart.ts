import { PublishedOffering } from '@r10c/business-ts-marketplace-catalog';
import { getOffering } from '@r10c/implementation-marketplace-catalog-next';

import { runRead } from '../catalog/catalog-reads';
import { readCart } from './cart-cookie';
import type { Tender } from './checkout-start';
import { pricedCartOf } from './priced-cart-state';

/**
 * The cart as the request's cookie holds it, priced from the published
 * catalog — read the same way by the cart, the review step and the checkout
 * itself. Only the reads live here; what is decided from them is
 * `pricedCartOf`'s.
 */
export async function readPricedCart(
  tender: (vendorId: string) => Tender = () => 'card',
) {
  const lines = await readCart();
  return pricedCartOf(
    await Promise.all(
      lines.map(async line => ({
        line,
        offering: await runRead(
          PublishedOffering,
          getOffering(line.offeringId),
          undefined,
        ),
      })),
    ),
    tender,
  );
}
