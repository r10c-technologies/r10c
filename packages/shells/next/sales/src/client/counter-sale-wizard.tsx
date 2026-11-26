'use client';

import { type EntityRepositoryTag, loadUCFactory } from '@entifix/business';
import {
  assertWizardDefinition,
  emptyWizardState,
  type EntityRowDraft,
  type FilterGroup,
  type Locale,
  newRowKey,
  readStepDraft,
  readStepIds,
  ROW_KEY,
  type WizardDefinition,
} from '@entifix/core';
import {
  useFollowWizardStepUrl,
  useWizardDraft,
  useWizardStepUrl,
} from '@entifix/next-shell';
import {
  Alert,
  Button,
  Card,
  Cluster,
  Money,
  QuantityInput,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
  useLocale,
  useTranslateKey,
  useUiPreference,
  Wizard,
} from '@entifix/react-controls';
import {
  useDataLoading,
  usePendingFlowStore,
} from '@entifix/react-integration';
import { PublishedOffering } from '@r10c/business-ts-marketplace-catalog';
import { SalesChannel } from '@r10c/business-ts-sales-management';
import {
  formatQuantity,
  lineTotal,
  quantityMaximum,
  SALE_UNIT_SYMBOL_KEY,
  saleLineRefusal,
  saleUnitScale,
  tieredPrice,
} from '@r10c/business-ts-sales-vocabulary';
import { useCallback, useEffect, useRef, useState } from 'react';

import { COUNTER_SALE_SURFACE } from '../sales-surfaces';
import {
  useSalesAdapters,
  useSalesScope,
  useSalesVendor,
} from './sales-context';

/**
 * The till's step graph.
 *
 * Three `custom` steps and a summary, which is the shape `assertWizardDefinition`
 * requires: a flow must end on exactly one summary, because committing without
 * the operator seeing what they answered is what #111 recorded as not optional.
 * Here that matters more than in an authoring wizard — the last step takes
 * money.
 *
 * `custom` rather than `form` for all three: a step's `form` kind is one
 * `useEntityForm` over part of *an entity*, and none of these edits an entity.
 * The channel is a reference to another record, the lines are rows priced from a
 * projection, and the payment method is one member of a `Payment` this browser
 * never constructs ([ADR 0045](../../../../../docs/adr/0045-the-wizard-a-step-graph-and-a-submit-that-hands-off.md)).
 */
export const COUNTER_SALE_WIZARD: WizardDefinition = {
  key: COUNTER_SALE_SURFACE.key,
  steps: [
    {
      id: 'channel',
      kind: 'custom',
      labelKey: 'r10c:sales.counterSale.steps.channel',
      to: ['lines'],
    },
    {
      id: 'lines',
      kind: 'custom',
      labelKey: 'r10c:sales.counterSale.steps.lines',
      to: ['payment'],
    },
    {
      id: 'payment',
      kind: 'custom',
      labelKey: 'r10c:sales.counterSale.steps.payment',
      to: ['summary'],
    },
    {
      id: 'summary',
      kind: 'summary',
      labelKey: 'r10c:sales.counterSale.steps.summary',
      to: [],
    },
  ],
};

assertWizardDefinition(COUNTER_SALE_WIZARD);

/** Where the flow begins — the first step declared, stated once. */
const ENTRY_STEP = 'channel';

/**
 * The most channels a till offers as one row of buttons.
 *
 * Past five a segmented row wraps or truncates, and a select is the better
 * control; at five or fewer every choice is visible and one tap away.
 */
export const SEGMENTED_CHANNEL_LIMIT = 5;

/**
 * The preference a till's last channel is remembered under, per scope.
 *
 * `undefined` without a scope: an unscoped key would be shared by every
 * principal and organization this browser has held.
 */
export const lastChannelKey = (
  scope: string | undefined,
): string | undefined =>
  scope === undefined ? undefined : `sales.counter-sale.last-channel:${scope}`;

/** How the money arrived. The set `Payment.paymentMethod` accepts. */
const PAYMENT_METHODS = ['cash', 'card', 'voucher', 'transfer'] as const;

/**
 * How the buyer is documented: consumidor final unless they give a NIT or a
 * CUI. Validated by sales-service and again by the coordinator, under the same
 * codes the storefront shows (ADR 0078 §6).
 */
const TAX_ID_TYPES = ['cf', 'nit', 'cui'] as const;

/** One line of the sale, as the draft carries it — every value a string. */
interface Line {
  readonly key: string;
  readonly offeringId: string;
  readonly name: string;
  readonly amount: number;
  readonly currency: string;
  readonly quantity: number;
}

/**
 * The lines a stored draft holds.
 *
 * ⚠️ **Every member is defaulted, because a draft is not trusted.** What comes
 * back from IndexedDB was written by whatever build was running then — ADR 0032's
 * rule — so a row missing a member restores as an empty one rather than as
 * `undefined` reaching an input and flipping it from controlled to
 * uncontrolled mid-render.
 */
export const readLines = (rows: readonly EntityRowDraft[]): readonly Line[] =>
  rows.map(row => ({
    key: row[ROW_KEY] ?? newRowKey(),
    offeringId: row['offeringId'] ?? '',
    name: row['name'] ?? '',
    amount: Number(row['amount'] ?? '0'),
    currency: row['currency'] ?? '',
    quantity: Number(row['quantity'] ?? '0'),
  }));

const writeLines = (lines: readonly Line[]): EntityRowDraft[] =>
  lines.map(line => ({
    [ROW_KEY]: line.key,
    offeringId: line.offeringId,
    name: line.name,
    amount: String(line.amount),
    currency: line.currency,
    quantity: String(line.quantity),
  }));

/**
 * What a line will cost, previewed by `lineTotal` over the offering's live
 * published terms at the volume price its quantity reaches (ADR 0082 §8) —
 * never the draft's, which is not trusted (ADR 0032), and never a price times
 * a quantity here. sales-service prices it again from the
 * projection, and its figure is the one charged (ADR 0082 §6). A line whose
 * offering is no longer listed previews as nothing: it cannot be sold.
 */
export const previewOf = (
  line: Line,
  offerings: readonly PublishedOffering[],
): number => {
  const offering = offerings.find(
    candidate => candidate.offeringId === line.offeringId,
  );
  return offering === undefined
    ? 0
    : lineTotal({
        amount: tieredPrice(offering, line.quantity).amount,
        pricePer: offering.pricePer,
        quantity: line.quantity,
        saleUnit: offering.saleUnit,
      });
};

/**
 * A line's quantity with its unit, by its offering's live terms: "3.5 m". A
 * line whose offering is no longer listed shows its bare number — it cannot be
 * sold, and the draft's own word for its unit is not trusted (ADR 0032).
 */
export const quantityTextOf = (
  line: Line,
  offerings: readonly PublishedOffering[],
  locale: Locale,
  translateKey: (key: string) => string,
): string => {
  const offering = offerings.find(
    candidate => candidate.offeringId === line.offeringId,
  );
  return offering === undefined
    ? String(line.quantity)
    : `${formatQuantity(line.quantity, offering.saleUnit, locale)} ${translateKey(
        `${SALE_UNIT_SYMBOL_KEY}.${offering.saleUnit}`,
      )}`;
};

const totalOf = (
  lines: readonly Line[],
  offerings: readonly PublishedOffering[],
): number => lines.reduce((sum, line) => sum + previewOf(line, offerings), 0);

/**
 * The offerings the till can pick from, one per id. The projection can answer
 * the same offering twice, and a select listing it twice reads as two products.
 */
/**
 * What the till's product list reads: the vendor's own published offerings,
 * narrowed by every word typed — a name, a code — as the storefront search
 * matches them (#774). Without a vendor, the words alone.
 */
export const tillFiltering = (
  vendorId: string | undefined,
  search: string,
): FilterGroup<PublishedOffering> | undefined => {
  const words = search
    .trim()
    .split(/\s+/)
    .filter(word => word !== '');
  const values = [
    ...(vendorId === undefined
      ? []
      : [
          {
            property: 'vendorId' as const,
            operator: 'eq' as const,
            value: vendorId,
          },
        ]),
    ...words.map(word => ({
      property: 'searchText' as const,
      operator: 'like' as const,
      value: word,
    })),
  ];
  return values.length === 0 ? undefined : { operator: 'and', values };
};

/**
 * What Enter on the search picks: the one product the words found — what a
 * scanner typing a code and Enter means. Several or none pick nothing, and
 * the list stays for the vendor to choose from.
 */
export const scanPick = <T extends { readonly offeringId: string }>(
  items: readonly T[],
): T | undefined => {
  const found = uniqueOfferings(items);
  return found.length === 1 ? found[0] : undefined;
};

/**
 * The lines with one more of an offering: added to its line when the sale
 * already holds it, a new line otherwise — so the till never sends one
 * offering on two lines, which the checkout refuses (ADR 0086 §4).
 */
export const withLine = <
  TLine extends { readonly offeringId: string; readonly quantity: number },
>(
  lines: readonly TLine[],
  line: TLine,
): TLine[] =>
  lines.some(one => one.offeringId === line.offeringId)
    ? lines.map(one =>
        one.offeringId === line.offeringId
          ? { ...one, quantity: one.quantity + line.quantity }
          : one,
      )
    : [...lines, line];

export const uniqueOfferings = <T extends { readonly offeringId: string }>(
  items: readonly T[],
): T[] =>
  Array.from(
    new Map(items.map(item => [item.offeringId, item] as const)).values(),
  );

/**
 * What the total is denominated in.
 *
 * One currency per sale, taken from the first line: the projection prices each
 * offering in its own, and a basket mixing two would need a rate nobody has
 * agreed on. Empty is the honest answer for an empty till rather than a
 * currency nobody chose.
 */
export const currencyOf = (lines: readonly Line[]): string =>
  lines.length === 0 ? '' : (lines[0] as Line).currency;

export interface CounterSaleWizardProps {
  /** The step a workspace tab was addressed at (`wizard:counter-sale:lines`). */
  step?: string;
  /** A host may take over what finishing means; a route returns to the list. */
  onFinished?: () => void;
}

/**
 * The till.
 *
 * ⚠️ **It posts to sales-service, and holds no secret of its own.** The
 * storefront's checkout action presents the coordinator's crossing token because
 * it has no session to check; this screen has one, and a browser cannot verify
 * a session — so the decision is made where verification exists, and this only
 * carries the cookie
 * ([ADR 0056](../../../../../docs/adr/0056-the-counter-sale-is-the-checkout-saga.md)).
 *
 * ⚠️ **The price on a line is display only.** The route re-prices every line
 * from the published projection and refuses any whose vendor is not the caller's
 * organization, so what this sends is an offering id and a quantity. A total
 * computed here that disagreed with the charge would be a bug in this file
 * alone, never a mischarge.
 */
export function CounterSaleWizard({
  step,
  onFinished,
}: CounterSaleWizardProps = {}) {
  const translateKey = useTranslateKey();
  const locale = useLocale();
  const adapters = useSalesAdapters();
  const draft = useWizardDraft(`wizard:${COUNTER_SALE_SURFACE.key}`);
  // An unopened till has no stored state, and every read below wants one. The
  // fallback is the entry step rather than `undefined` for the reason every
  // draft read in this repo has one: a form handed `undefined` flips its inputs
  // from controlled to uncontrolled mid-render.
  const state = draft.state ?? emptyWizardState(ENTRY_STEP);

  // The writer comes first and is handed to `useWizard`'s sibling hooks
  // directly: the push has to land in the same commit as the move, or the
  // follower sees the address and the active step disagree and reads it as a
  // Back.
  const writeStep = useWizardStepUrl();
  const [activeStep, setActiveStep] = useState<string>(
    draft.state?.activeStep ?? ENTRY_STEP,
  );
  const goTo = useCallback(
    (stepId: string) => {
      setActiveStep(stepId);
      writeStep(stepId);
    },
    [writeStep],
  );
  useFollowWizardStepUrl({ activeStep, entryStep: ENTRY_STEP, goTo });

  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || step === undefined) return;
    opened.current = true;
    goTo(step);
  }, [step, goTo]);

  const channels = useDataLoading<SalesChannel, EntityRepositoryTag>({
    uc: loadUCFactory<SalesChannel>(),
    ctx: adapters.salesChannelRest,
    initialPageSize: 50,
    queryKey: ['sales-channel', 'counter-sale'],
  });

  const vendorId = useSalesVendor();
  const [search, setSearch] = useState('');
  const offerings = useDataLoading<PublishedOffering, EntityRepositoryTag>({
    uc: loadUCFactory<PublishedOffering>(),
    ctx: adapters.publishedOfferingRest,
    initialPageSize: 50,
    baseFiltering: tillFiltering(vendorId, search),
    queryKey: ['published-offering', 'counter-sale', vendorId, search],
  });

  // A retired channel takes no sale, and the route refuses one, so offering it
  // here would be offering a dead end.
  const activeChannels = channels.items.filter(
    channel => channel.status === 'active',
  );
  const scope = useSalesScope();
  const preferenceKey = lastChannelKey(scope);
  const lastChannel = useUiPreference<string>(
    preferenceKey ?? 'sales.counter-sale.last-channel',
    '',
  );

  const [channelId] = readStepIds(state, 'channel');
  const lines = readLines(
    (readStepDraft(state, 'lines')['lines'] ?? []) as readonly EntityRowDraft[],
  );
  const payment = readStepDraft(state, 'payment') as Partial<
    Record<'paymentMethod' | 'taxIdType' | 'taxId' | 'taxName', string>
  >;
  const paymentMethod = payment.paymentMethod ?? 'cash';
  const taxIdType = payment.taxIdType ?? 'cf';
  const taxId = payment.taxId ?? '';
  const taxName = payment.taxName ?? '';
  const identified = taxIdType !== 'cf';

  const [pendingOffering, setPendingOffering] = useState('');
  // In the picked offering's scale; `NaN` while the field holds no number.
  const [pendingQuantity, setPendingQuantity] = useState(Number.NaN);
  const picked = offerings.items.find(
    candidate => candidate.offeringId === pendingOffering,
  );
  // Decided against the published terms as typed, and refused rather than
  // rounded (ADR 0082 §3); sales-service checks again, and its answer stands.
  const pendingRefusal =
    picked === undefined
      ? undefined
      : saleLineRefusal(picked.offeringId, pendingQuantity, picked, {
          amount: tieredPrice(picked, pendingQuantity).amount,
          pricePer: picked.pricePer,
        });
  const pick = (offeringId: string) => {
    setPendingOffering(offeringId);
    const offering = offerings.items.find(
      candidate => candidate.offeringId === offeringId,
    );
    setPendingQuantity(offering?.quantityMinimum ?? Number.NaN);
  };
  const quantityText = (line: Line) =>
    quantityTextOf(line, offerings.items, locale, translateKey);
  const [receiptId, setReceiptId] = useState<string | undefined>(undefined);
  const [charging, setCharging] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  // The checkout the till started and is waiting on: the sale is written when
  // it completes, never when the service answers (ADR 0073).
  const [pendingFlow, setPendingFlow] = useState<string | undefined>(undefined);
  const flows = usePendingFlowStore();

  useEffect(() => {
    if (pendingFlow === undefined || flows === undefined) return undefined;
    flows.add({ flowId: pendingFlow });
    return flows.onSettled(pendingFlow, outcome => {
      setPendingFlow(undefined);
      setCharging(false);
      if (outcome.kind === 'confirmed') {
        // The draft is cleared only once the sale is written: a till emptied
        // before the flow completed loses a basket the seller would retry.
        draft.clear();
        setReceiptId(pendingFlow);
        return;
      }
      setFailure(outcome.failure?.code ?? 'unexpected');
    });
  }, [pendingFlow, flows, draft]);

  const save = draft.save;
  const setChannel = (id: string) =>
    save({
      ...state,
      steps: {
        ...state.steps,
        channel: { kind: 'selection', ids: id === '' ? [] : [id] },
      },
    });

  // The question a till asks on every sale is answered for the vendor when the
  // answer cannot vary: with one active channel the step is filled and the till
  // opens on the lines; with several, the one last sold through is preselected.
  // Once per mount, and only while nothing was chosen, so Back to the channel
  // step shows the answer instead of skipping again. The step stays in the
  // graph either way, and the summary names the channel before money is taken
  // (ADR 0045).
  const chose = useRef(false);
  useEffect(() => {
    // The memory is read before anything is chosen, or a fast channel list
    // would preselect the first one over the channel the vendor last used.
    const waiting = channels.isLoading || !lastChannel.isReady;
    if (chose.current || waiting || channelId !== undefined) return;
    if (activeStep !== ENTRY_STEP || step !== undefined) return;
    if (activeChannels.length === 1) {
      chose.current = true;
      setChannel(String((activeChannels[0] as SalesChannel).id));
      // Moved through the address rather than `goTo`: the follower above turns
      // the push into the move, so browser-Back from the lines lands on the
      // channel step exactly as a manual Continuar would have left it.
      writeStep('lines');
      return;
    }
    if (activeChannels.length === 0) return;
    chose.current = true;
    // The last channel sold through. Failing that, a row of buttons takes its
    // first — it always shows one as chosen, so the one it shows has to be the
    // one the sale would use — while a select can honestly show none.
    const preselected =
      activeChannels.find(
        channel => String(channel.id) === lastChannel.value,
      ) ??
      (activeChannels.length <= SEGMENTED_CHANNEL_LIMIT
        ? activeChannels[0]
        : undefined);
    if (preselected !== undefined) setChannel(String(preselected.id));
  }, [
    activeChannels,
    activeStep,
    channelId,
    channels.isLoading,
    lastChannel.isReady,
    lastChannel.value,
    setChannel,
    step,
    writeStep,
  ]);

  const setLines = (next: readonly Line[]) =>
    save({
      ...state,
      steps: {
        ...state.steps,
        lines: { kind: 'form', values: { lines: writeLines(next) } },
      },
    });

  const setPayment = (patch: Partial<typeof payment>) =>
    save({
      ...state,
      steps: {
        ...state.steps,
        payment: {
          kind: 'form',
          values: { paymentMethod, taxIdType, taxId, taxName, ...patch },
        },
      },
    });

  const addLine = () => {
    // Nothing picked, or a quantity the offering does not sell: the field
    // already says why, and nothing is added.
    if (picked === undefined || pendingRefusal !== undefined) return;
    const offering = picked;
    const quantity = pendingQuantity;
    setLines(
      withLine(lines, {
        key: newRowKey(),
        offeringId: offering.offeringId,
        name: offering.name,
        amount: offering.amount,
        currency: offering.currency,
        quantity,
      }),
    );
    setPendingOffering('');
    setPendingQuantity(Number.NaN);
  };

  // One key per sale, kept across a charge that never reached the service so
  // that pressing Finalizar again starts the same checkout rather than a second
  // one; dropped once the service has answered, because that sale is decided.
  const saleKey = useRef<string | undefined>(undefined);

  const charge = async () => {
    setCharging(true);
    setFailure(undefined);
    saleKey.current ??= globalThis.crypto.randomUUID();
    const response = await fetch(
      `/api/sales/sales-channel/${encodeURIComponent(String(channelId))}/sell`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': `"${saleKey.current}"`,
        },
        body: JSON.stringify({
          paymentMethod,
          buyerTax: identified
            ? { idType: taxIdType, taxId, name: taxName }
            : { idType: 'cf' },
          lines: lines.map(line => ({
            offeringId: line.offeringId,
            quantity: line.quantity,
          })),
        }),
      },
    ).catch(() => undefined);
    if (response !== undefined) saleKey.current = undefined;

    const body = (await response?.json().catch(() => undefined)) as
      { code?: string; data?: { flowId?: string } } | undefined;
    // Accepted: the checkout is running, and the till waits on its outcome
    // with the button still busy.
    if (response?.status === 202 && typeof body?.data?.flowId === 'string') {
      setPendingFlow(body.data.flowId);
      if (preferenceKey !== undefined) lastChannel.setValue(String(channelId));
      return;
    }
    setCharging(false);
    setFailure(body?.code ?? 'unexpected');
  };

  const canAdvance =
    activeStep === 'channel'
      ? channelId !== undefined
      : activeStep === 'lines'
        ? lines.length > 0
        : activeStep === 'payment'
          ? !identified || (taxId.trim() !== '' && taxName.trim() !== '')
          : true;

  if (receiptId !== undefined) {
    return (
      <Card>
        <Stack>
          <Text>{translateKey('r10c:sales.counterSale.sold')}</Text>
          <Text>{translateKey('r10c:sales.counterSale.soldDetail')}</Text>
          <Button
            onClick={() => {
              setReceiptId(undefined);
              goTo(ENTRY_STEP);
              onFinished?.();
            }}
          >
            {translateKey('r10c:sales.counterSale.newSale')}
          </Button>
        </Stack>
      </Card>
    );
  }

  const stepIndex = COUNTER_SALE_WIZARD.steps.findIndex(
    candidate => candidate.id === activeStep,
  );

  /**
   * Move by one step, clamped to the graph.
   *
   * Clamped rather than guarded: `onNext` is only rendered on a step that has a
   * next one and `onPrevious` only past the entry, so a guard here would be a
   * branch nothing can take — and an unreachable branch reads as a case somebody
   * forgot to handle.
   */
  const stepBy = (offset: number) => {
    const index = Math.min(
      Math.max(stepIndex + offset, 0),
      COUNTER_SALE_WIZARD.steps.length - 1,
    );
    goTo((COUNTER_SALE_WIZARD.steps[index] as { id: string }).id);
  };

  return (
    <Wizard
      steps={COUNTER_SALE_WIZARD.steps.map((candidate, index) => ({
        id: candidate.id,
        label: translateKey(candidate.labelKey),
        status:
          index < stepIndex
            ? 'complete'
            : index === stepIndex
              ? 'active'
              : 'pending',
      }))}
      activeStep={activeStep}
      title={translateKey('r10c:sales.counterSale.title')}
      canFinish={activeStep === 'summary'}
      canAdvance={canAdvance}
      isSubmitting={charging}
      onNext={() => stepBy(1)}
      onPrevious={stepIndex > 0 ? () => stepBy(-1) : undefined}
      onFinish={() => {
        void charge();
      }}
    >
      {activeStep === 'channel' && (
        <Stack>
          <Text>{translateKey('r10c:sales.counterSale.channelHint')}</Text>
          {activeChannels.length > 0 &&
          activeChannels.length <= SEGMENTED_CHANNEL_LIMIT ? (
            <SegmentedControl
              label={translateKey('r10c:sales.counterSale.steps.channel')}
              options={activeChannels.map(channel => ({
                key: String(channel.id),
                label: channel.name,
              }))}
              value={channelId ?? ''}
              onChange={setChannel}
            />
          ) : (
            <>
              <label htmlFor="counter-sale-channel">
                {translateKey('r10c:sales.counterSale.steps.channel')}
              </label>
              <Select
                id="counter-sale-channel"
                value={channelId ?? ''}
                onChange={event => setChannel(event.target.value)}
                disabled={channels.isLoading}
              >
                <option value="">—</option>
                {activeChannels.map(channel => (
                  <option key={String(channel.id)} value={String(channel.id)}>
                    {channel.name}
                  </option>
                ))}
              </Select>
            </>
          )}
        </Stack>
      )}

      {activeStep === 'lines' && (
        <Stack>
          <Text>{translateKey('r10c:sales.counterSale.linesHint')}</Text>
          <Cluster>
            <label htmlFor="counter-sale-search">
              {translateKey('r10c:sales.counterSale.search')}
            </label>
            <TextInput
              id="counter-sale-search"
              type="search"
              value={search}
              onChange={event => setSearch(event.target.value)}
              onKeyDown={event => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                const found = scanPick(offerings.items);
                if (found !== undefined) pick(found.offeringId);
              }}
            />
          </Cluster>
          <Cluster>
            <label htmlFor="counter-sale-offering">
              {translateKey('r10c:sales.counterSale.offering')}
            </label>
            <Select
              id="counter-sale-offering"
              value={pendingOffering}
              onChange={event => pick(event.target.value)}
              disabled={offerings.isLoading}
            >
              <option value="">—</option>
              {uniqueOfferings(offerings.items).map(offering => (
                <option key={offering.offeringId} value={offering.offeringId}>
                  {offering.name}
                </option>
              ))}
            </Select>
            {picked === undefined ? (
              <QuantityInput
                id="counter-sale-quantity"
                label={translateKey('r10c:sales.counterSale.quantity')}
                value={1}
                min={1}
                disabled
                onChange={setPendingQuantity}
              />
            ) : (
              // In the offering's unit and scale (ADR 0082 §2): 3.5 typed for
              // cable is 3500 here, and a quantity it does not sell is marked,
              // never clamped.
              <QuantityInput
                key={picked.offeringId}
                id="counter-sale-quantity"
                label={translateKey('r10c:sales.counterSale.quantity')}
                value={pendingQuantity}
                scale={saleUnitScale(picked.saleUnit)}
                unit={translateKey(
                  `${SALE_UNIT_SYMBOL_KEY}.${picked.saleUnit}`,
                )}
                min={picked.quantityMinimum}
                step={picked.quantityStep}
                max={quantityMaximum(picked)}
                invalid={pendingRefusal !== undefined}
                {...(pendingRefusal === undefined
                  ? {}
                  : { 'aria-describedby': 'counter-sale-quantity-refused' })}
                onChange={setPendingQuantity}
              />
            )}
            <Button onClick={addLine}>
              {translateKey('r10c:sales.counterSale.addLine')}
            </Button>
          </Cluster>
          {pendingRefusal === undefined ? null : (
            <Alert id="counter-sale-quantity-refused" tone="warning">
              {translateKey(`errors:${pendingRefusal.code}`)}
            </Alert>
          )}
          <Stack>
            {lines.map(line => (
              <Cluster key={line.key}>
                <Text>
                  {quantityText(line)} × {line.name}
                </Text>
                <Button
                  variant="ghost"
                  onClick={() =>
                    setLines(lines.filter(other => other.key !== line.key))
                  }
                >
                  {translateKey('r10c:sales.counterSale.removeLineNamed', {
                    name: line.name,
                  })}
                </Button>
              </Cluster>
            ))}
            {lines.length === 0 && (
              <Text>{translateKey('r10c:sales.counterSale.emptyLines')}</Text>
            )}
          </Stack>
        </Stack>
      )}

      {activeStep === 'payment' && (
        <Stack>
          <label htmlFor="counter-sale-payment-method">
            {translateKey('r10c:sales.counterSale.paymentMethod')}
          </label>
          <Select
            id="counter-sale-payment-method"
            value={paymentMethod}
            onChange={event =>
              setPayment({ paymentMethod: event.target.value })
            }
          >
            {PAYMENT_METHODS.map(method => (
              <option key={method} value={method}>
                {translateKey(`r10c:sales.counterSale.tender.${method}`)}
              </option>
            ))}
          </Select>
          <label htmlFor="counter-sale-tax-id-type">
            {translateKey('r10c:sales.counterSale.tax.idType')}
          </label>
          <Select
            id="counter-sale-tax-id-type"
            value={taxIdType}
            onChange={event => setPayment({ taxIdType: event.target.value })}
          >
            {TAX_ID_TYPES.map(type => (
              <option key={type} value={type}>
                {translateKey(`r10c:sales.counterSale.tax.idTypes.${type}`)}
              </option>
            ))}
          </Select>
          {identified && (
            <>
              <label htmlFor="counter-sale-tax-id">
                {translateKey('r10c:sales.counterSale.tax.taxId')}
              </label>
              <TextInput
                id="counter-sale-tax-id"
                value={taxId}
                autoComplete="off"
                onChange={event => setPayment({ taxId: event.target.value })}
              />
              <label htmlFor="counter-sale-tax-name">
                {translateKey('r10c:sales.counterSale.tax.name')}
              </label>
              <TextInput
                id="counter-sale-tax-name"
                value={taxName}
                autoComplete="off"
                onChange={event => setPayment({ taxName: event.target.value })}
              />
            </>
          )}
        </Stack>
      )}

      {activeStep === 'summary' && (
        <Stack>
          <Text>
            {translateKey('r10c:sales.counterSale.steps.channel')}:{' '}
            {
              activeChannels.find(channel => String(channel.id) === channelId)
                ?.name
            }
          </Text>
          {lines.map(line => (
            <Text key={line.key}>
              {quantityText(line)} × {line.name} —{' '}
              <Money
                amount={previewOf(line, offerings.items)}
                currency={line.currency}
                unit="minor"
                locale={locale}
              />
            </Text>
          ))}
          <Text>
            {translateKey('r10c:sales.counterSale.tax.billedTo')}:{' '}
            {identified
              ? `${taxId} — ${taxName}`
              : translateKey('r10c:sales.counterSale.tax.idTypes.cf')}
          </Text>
          <Text>
            {translateKey('r10c:sales.counterSale.total')}:{' '}
            <Money
              amount={totalOf(lines, offerings.items)}
              currency={currencyOf(lines)}
              unit="minor"
              locale={locale}
            />
          </Text>
          {failure !== undefined && (
            <Alert tone="danger">{translateKey(`errors:${failure}`)}</Alert>
          )}
        </Stack>
      )}
    </Wizard>
  );
}
