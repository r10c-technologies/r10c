import {
  Agreement,
  CommissionEntry,
  SettlementRun,
  VendorPayout,
} from '@r10c/business-ts-settlement-management';
import { EntifixQueryProvider } from '@r10c/entifix-react-integration';
import {
  ConfigurationRepositoryTag,
  EntityRepositoryTag,
} from '@r10c/entifix-ts-business';
import { EntifixConnError,type Entity } from '@r10c/entifix-ts-core';
import {
  makeInMemoryEntityRepository,
  makeStubConfigurationClient,
} from '@r10c/entifix-ts-testing-unit';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Context } from 'effect';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgreementSingleViewClientPage } from './agreement-single-view.js';
import type { SettlementAdapters } from './client-types.js';
import { SettlementProvider } from './settlement-context.js';
import {
  agreementCrud,
  AgreementListClientPage,
  commissionEntryCrud,
  CommissionEntryListClientPage,
  SETTLEMENT_MASTER_CRUDS,
  SETTLEMENT_OPERATION_CRUDS,
  settlementRunCrud,
  SettlementRunListClientPage,
  vendorPayoutCrud,
  VendorPayoutListClientPage,
  VendorPayoutSingleViewClientPage,
} from './settlement-crud.js';

// Most of these pages are `makeEntityCrud` output, so what is worth asserting is
// that the generator was handed the right facts — the adapter each screen reads,
// the route it lives at, and the metadata source that decides its affordances.
// The agreement's record page is not generated, and gets its own assertions.
//
// The pages read the route through `next/navigation`, which only exists inside a
// running Next app; the slug is the one input a test needs to vary.
let slug = 'new';

// Hoisted so a spec can assert the routed-page path: without an `onSaved` prop
// the page navigates itself, and that arm is only reachable from a real route.
const push = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useParams: () => ({ slug }),
}));

const makeAgreement = () => {
  const agreement = new Agreement('acme', 800);
  agreement.id = 'agreement-acme';
  agreement.channelCommissionBasisPoints = { counter: 0 };
  return agreement;
};

const makeEntry = () => {
  const entry = new CommissionEntry(
    'order-1',
    'acme',
    2500,
    200,
    'GTQ',
    new Date('2026-03-04T10:00:00.000Z'),
  );
  entry.id = 'commission-entry-1';
  return entry;
};

const makeRun = () => {
  const run = new SettlementRun(
    new Date('2026-03-01T00:00:00.000Z'),
    new Date('2026-03-31T23:59:59.000Z'),
  );
  run.id = 'settlement-run-1';
  run.status = 'calculated';
  return run;
};

const makePayout = () => {
  const payout = new VendorPayout('settlement-run-1', 'acme', 2300, 'GTQ');
  payout.id = 'vendor-payout-1';
  return payout;
};

let repositories: {
  agreement: ReturnType<typeof makeInMemoryEntityRepository>;
  entry: ReturnType<typeof makeInMemoryEntityRepository>;
  run: ReturnType<typeof makeInMemoryEntityRepository>;
  payout: ReturnType<typeof makeInMemoryEntityRepository>;
};

const adapters = (): SettlementAdapters => ({
  agreementRest: Context.make(EntityRepositoryTag, repositories.agreement),
  commissionEntryRest: Context.make(EntityRepositoryTag, repositories.entry),
  settlementRunRest: Context.make(EntityRepositoryTag, repositories.run),
  vendorPayoutRest: Context.make(EntityRepositoryTag, repositories.payout),
  configurationStore: Context.make(
    ConfigurationRepositoryTag,
    makeStubConfigurationClient(),
  ),
});

const renderPage = (page: ReactElement) =>
  render(
    <EntifixQueryProvider>
      <SettlementProvider adapters={adapters()}>{page}</SettlementProvider>
    </EntifixQueryProvider>,
  );

beforeEach(() => {
  slug = 'new';
  push.mockClear();
  repositories = {
    agreement: makeInMemoryEntityRepository([makeAgreement()] as Entity[]),
    entry: makeInMemoryEntityRepository([makeEntry()] as Entity[]),
    run: makeInMemoryEntityRepository([makeRun()] as Entity[]),
    payout: makeInMemoryEntityRepository([makePayout()] as Entity[]),
  };
});

describe('the settlement descriptors', () => {
  /**
   * ⚠️ **Two tuples, not one.** The workspace registry spreads them into two
   * different tab kinds, because an agreement is authored and the rest are
   * produced — and a registry that took one list would have to pick a tier for
   * all four (ADR 0033).
   */
  it('exposes the screens each tier’s tab kind derives from', () => {
    expect(SETTLEMENT_MASTER_CRUDS.map(crud => crud.entityKey)).toEqual([
      'agreement',
    ]);
    expect(SETTLEMENT_OPERATION_CRUDS.map(crud => crud.entityKey)).toEqual([
      'commission-entry',
      'settlement-run',
      'vendor-payout',
    ]);
  });

  it('names each screen from the entity’s own decorator', () => {
    // The tab caption and the table heading come from the same place, so one
    // cannot drift from the other.
    expect(agreementCrud.entityLabelKey).toBe('entity:agreement.label');
    expect(agreementCrud.entityPluralKey).toBe('entity:agreement.plural');
    expect(commissionEntryCrud.entityPluralKey).toBe(
      'entity:commission-entry.plural',
    );
    expect(vendorPayoutCrud.entityLabelKey).toBe('entity:vendor-payout.label');
  });

  it('generates each screen at the route its surface declares', () => {
    expect(agreementCrud.basePath).toBe('/settlement/agreement');
    expect(commissionEntryCrud.basePath).toBe('/settlement/commission-entry');
    expect(settlementRunCrud.basePath).toBe('/settlement/settlement-run');
    expect(vendorPayoutCrud.basePath).toBe('/settlement/vendor-payout');
  });

  /**
   * ⚠️ **The agreement's list is generated and its record page is not**, and
   * the split is exactly as wide as it has to be. A list renders cells from
   * metadata and a map member is a column nobody reads; a form renders *inputs*,
   * and there is no input for a map.
   */
  it('replaces only the agreement’s record page', () => {
    expect(agreementCrud.SingleViewPage).toBe(AgreementSingleViewClientPage);
    expect(vendorPayoutCrud.SingleViewPage).toBe(
      VendorPayoutSingleViewClientPage,
    );
  });
});

describe('the listing pages', () => {
  it.each([
    ['agreements', <AgreementListClientPage key="a" />],
    ['commission entries', <CommissionEntryListClientPage key="c" />],
    ['vendor payouts', <VendorPayoutListClientPage key="p" />],
  ])('lists %s from the adapters it was given', async (_label, page) => {
    renderPage(page);

    await waitFor(() =>
      expect(screen.getAllByText('acme').length).toBeGreaterThan(0),
    );
  });

  it('lists runs, which carry no vendor at all', async () => {
    renderPage(<SettlementRunListClientPage />);

    await waitFor(() =>
      expect(screen.getAllByText('Calculada').length).toBeGreaterThan(0),
    );
  });
});

describe('the agreement record page', () => {
  it('renders the default rate for a loaded record', async () => {
    slug = 'agreement-acme';
    renderPage(<AgreementSingleViewClientPage />);

    await waitFor(() =>
      expect(screen.getByDisplayValue('800')).toBeInTheDocument(),
    );
  });

  /**
   * ⚠️ **The distinction the per-channel map exists for.** `counter` is `0` and
   * every other channel is absent, and a control that coerced one into the other
   * would make the term unexpressible through the only surface that authors it.
   */
  it('shows a zero channel rate and an absent one as different values', async () => {
    slug = 'agreement-acme';
    renderPage(<AgreementSingleViewClientPage />);

    await waitFor(() =>
      expect(screen.getByDisplayValue('800')).toBeInTheDocument(),
    );

    const inputs = screen.getAllByRole('spinbutton') as HTMLInputElement[];
    const values = inputs.map(input => input.value);

    expect(values).toContain('0');
    // Three of the four channel inputs carry no value at all, beside the
    // default-rate input which carries 800.
    expect(values.filter(value => value === '').length).toBe(3);
  });

  it('renders an empty form for a new record', async () => {
    renderPage(<AgreementSingleViewClientPage />);

    await waitFor(() =>
      expect(screen.getAllByRole('spinbutton').length).toBeGreaterThan(0),
    );
  });
});

describe('saving an agreement', () => {
  it('navigates away once the record is written', async () => {
    // The success arm of the save, which is the whole of what this page adds
    // over the form: the form reports a rebuilt entity, the page persists it
    // and leaves.
    slug = 'agreement-acme';
    const onSaved = vi.fn();
    renderPage(<AgreementSingleViewClientPage onSaved={onSaved} />);

    await waitFor(() =>
      expect(screen.getByDisplayValue('800')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  /**
   * The same save from a routed page rather than a workspace tab. A tab is told
   * what to do afterwards; a route returns to the list on its own, and the two
   * hosts differ in nothing else.
   */
  it('returns to the list when no host says otherwise', async () => {
    slug = 'agreement-acme';
    renderPage(<AgreementSingleViewClientPage />);

    await waitFor(() =>
      expect(screen.getByDisplayValue('800')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }));

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        expect.stringContaining('/settlement/agreement'),
      ),
    );
  });

  /**
   * ⚠️ **A refused save leaves the form where it is.** Navigating away on a
   * write that did not land is how an edit is lost silently — the list reloads,
   * the old values come back, and nothing says the save failed.
   */
  it('stays on the form when the write is refused', async () => {
    slug = 'agreement-acme';
    const onSaved = vi.fn();
    renderPage(<AgreementSingleViewClientPage onSaved={onSaved} />);

    await waitFor(() =>
      expect(screen.getByDisplayValue('800')).toBeInTheDocument(),
    );
    repositories.agreement.failNext(new EntifixConnError('refused'));
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }));

    await waitFor(() =>
      expect(screen.getByDisplayValue('800')).toBeInTheDocument(),
    );
    expect(onSaved).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });
});
