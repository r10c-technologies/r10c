import { accessor, type Entity, entity } from '@r10c/entifix-ts-core';
import { describe, expect, it } from 'vitest';

import {
  AGREEMENT_SURFACE,
  COMMISSION_ENTRY_SURFACE,
  permissionForSettlementSurface,
  SETTLEMENT_MASTER_SURFACES,
  SETTLEMENT_OPERATION_SURFACES,
  SETTLEMENT_RUN_SURFACE,
  SETTLEMENT_SURFACES,
  settlementListAddress,
  settlementRecordAddress,
  settlementSurface,
  VENDOR_PAYOUT_SURFACE,
} from './settlement-surfaces';

describe('the settlement surfaces', () => {
  it('declares the four the back office serves, in nav order', () => {
    expect(SETTLEMENT_SURFACES.map(surface => surface.entityKey)).toEqual([
      'agreement',
      'commission-entry',
      'settlement-run',
      'vendor-payout',
    ]);
  });

  /**
   * ⚠️ **The claim this shell exists to make.** Every other domain shell
   * contributes screens of one kind and hard-codes it; this one spans two tiers
   * by ADR 0033's own test — an agreement is authored and every settled sale
   * then references it, while a ledger line, a run and a payout are each
   * produced by a process.
   */
  it('splits Definiciones from Operaciones by who made the record', () => {
    expect(
      SETTLEMENT_MASTER_SURFACES.map(surface => surface.entityKey),
    ).toEqual(['agreement']);
    expect(
      SETTLEMENT_OPERATION_SURFACES.map(surface => surface.entityKey),
    ).toEqual(['commission-entry', 'settlement-run', 'vendor-payout']);
  });

  it('carries the screen type on the surface rather than assuming one', () => {
    expect(AGREEMENT_SURFACE.screenType).toBe('master');
    expect(COMMISSION_ENTRY_SURFACE.screenType).toBe('operation');
    expect(SETTLEMENT_RUN_SURFACE.screenType).toBe('operation');
    expect(VENDOR_PAYOUT_SURFACE.screenType).toBe('operation');
  });

  it('reads each entity’s plural from its own decorator', () => {
    // Not rebuilt from the key: a second place that knows how an entity's
    // catalog subtree is laid out is a second place to fix when one moves.
    expect(AGREEMENT_SURFACE.entityPluralKey).toBe('entity:agreement.plural');
    expect(VENDOR_PAYOUT_SURFACE.entityPluralKey).toBe(
      'entity:vendor-payout.plural',
    );
  });

  /**
   * ⚠️ **Derived from `@entity({ domain, key })`, never written out.** A
   * hand-written domain string here could name a domain the route behind it does
   * not check, which is a nav item that renders and a request that 403s.
   */
  it('derives each surface’s permission from its entity', () => {
    expect(permissionForSettlementSurface(AGREEMENT_SURFACE)).toBe(
      'settlement-management:agreement:read',
    );
    expect(permissionForSettlementSurface(VENDOR_PAYOUT_SURFACE)).toBe(
      'settlement-management:vendor-payout:read',
    );
  });

  /**
   * The address is the taxonomy serialized, so each surface addresses its tab
   * under its own type. A shell that hard-coded one would put
   * `master:vendor-payout` in a URL and the registry would then have to keep
   * that lie (ADR 0042).
   */
  it('addresses each tab under the surface’s own tier', () => {
    expect(settlementListAddress(AGREEMENT_SURFACE)).toBe('master:agreement');
    expect(settlementListAddress(VENDOR_PAYOUT_SURFACE)).toBe(
      'operation:vendor-payout',
    );
    expect(settlementRecordAddress(AGREEMENT_SURFACE, 'a-1')).toBe(
      'master:agreement:a-1',
    );
    expect(settlementRecordAddress(VENDOR_PAYOUT_SURFACE, 'p-1')).toBe(
      'operation:vendor-payout:p-1',
    );
  });

  it('names every record by a member that can actually name one', () => {
    // `defineRecordSearchSource` refuses a label member that is not
    // simultaneously a string, filterable and sortable, at module load. Until
    // `vendorId` gained `sortable: true`, no settlement entity had one.
    for (const surface of [
      AGREEMENT_SURFACE,
      COMMISSION_ENTRY_SURFACE,
      VENDOR_PAYOUT_SURFACE,
    ]) {
      expect(surface.labelProperty).toBe('vendorId');
      expect(surface.searchProperty).toBe('vendorId');
    }
  });

  it('routes every surface under its own domain segment', () => {
    for (const surface of SETTLEMENT_SURFACES) {
      expect(surface.basePath).toBe(`/settlement/${surface.entityKey}`);
    }
  });

  it('refuses an entity that declared no plural', () => {
    // At module load, where the surface is declared — rather than by titling a
    // search group `undefined` on the first keystroke.
    @entity({ domain: 'settlement-management', key: 'agreement' })
    class Unnamed implements Entity {
      #id?: string;

      @accessor({})
      get id(): string | undefined {
        return this.#id;
      }
      set id(value: string | undefined) {
        this.#id = value;
      }
    }

    expect(() =>
      settlementSurface(Unnamed, {
        entityKey: 'agreement',
        screenType: 'master',
        basePath: '/settlement/agreement',
        icon: '⚖',
        navLabelKey: 'shell:settlement.nav.agreements',
        searchProperty: 'vendorId',
        labelProperty: 'vendorId',
      }),
    ).toThrow('pluralKey');
  });
});
