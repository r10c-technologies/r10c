import { describeEntityUseCases } from '@r10c/entifix-ts-core';
import { describe, expect, it } from 'vitest';

import { ProductOffering } from '../entities/product-offering/product-offering.entity.js';
import {
  PUBLISH_PRODUCT_OFFERING,
  PublishProductOfferingUC,
} from './publish-product-offering/publish-product-offering.uc.js';
import { transitionOffering } from './transition-offering/transition-offering.js';
import {
  UNPUBLISH_PRODUCT_OFFERING,
  UnpublishProductOfferingUC,
} from './unpublish-product-offering/unpublish-product-offering.uc.js';

const LIFECYCLE: Array<[string, { run: () => unknown }, string]> = [
  ['publish', PublishProductOfferingUC, PUBLISH_PRODUCT_OFFERING],
  ['unpublish', UnpublishProductOfferingUC, UNPUBLISH_PRODUCT_OFFERING],
];

describe.each(LIFECYCLE)('%s on a product offering', (key, uc, permission) => {
  const descriptor = () =>
    describeEntityUseCases(ProductOffering).find(one => one.key === key);

  it('is declared against the entity', () => {
    expect(descriptor()).toBeDefined();
  });

  /**
   * `entity`-bound: the subject is one record. There is no bulk form in v1, and
   * a collection-bound publish would write forty projections from forty
   * different price snapshots on one click.
   */
  it('is bound to one record', () => {
    expect(descriptor()?.binding).toBe('entity');
  });

  /**
   * `context-independent`, which `ACTION_SURFACES` puts in the **form header**.
   * Not the row overflow menu — a vendor publishes the offering they have just
   * read and priced, not one they have only seen a row of.
   */
  it('renders in the form header, not on a list row', () => {
    expect(descriptor()?.placement).toBe('context-independent');
  });

  it('asks first', () => {
    expect(descriptor()?.confirm).toBeDefined();
  });

  it('derives its permission from the declaration', () => {
    expect(permission).toBe(
      `product-configuration-management:product-offering:${key}`,
    );
  });

  /**
   * Both verbs run the same effect; the route supplies which way. They are two
   * use cases rather than one because the **permission** is per verb — an
   * operator may be trusted to publish and not to take a live listing down —
   * while the rule they share is a single table.
   */
  it('runs the shared transition effect', () => {
    expect(uc.run()).toBe(transitionOffering);
  });
});

describe('the two verbs together', () => {
  it('are distinct permissions', () => {
    expect(PUBLISH_PRODUCT_OFFERING).not.toBe(UNPUBLISH_PRODUCT_OFFERING);
  });

  it('are the only verbs this entity declares', () => {
    // Pinned: a third verb added without a grant would fail `@r10c/slices`, but
    // one added *with* a grant and no surface would pass everything and appear
    // nowhere. This is the reminder to place it.
    expect(describeEntityUseCases(ProductOffering).map(one => one.key)).toEqual(
      ['publish', 'unpublish'],
    );
  });
});
