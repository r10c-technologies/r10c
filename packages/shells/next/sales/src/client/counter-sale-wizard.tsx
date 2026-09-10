'use client';

import { PublishedOffering } from '@r10c/business-ts-marketplace-catalog';
import { SalesChannel } from '@r10c/business-ts-sales-management';
import {
  Button,
  Card,
  Cluster,
  Select,
  Stack,
  Text,
  TextInput,
  useTranslateKey,
  Wizard,
} from '@r10c/entifix-react-controls';
import { useDataLoading } from '@r10c/entifix-react-integration';
import { loadUCFactory } from '@r10c/entifix-ts-business';
import {
  assertWizardDefinition,
  emptyWizardState,
  type EntityRowDraft,
  newRowKey,
  readStepDraft,
  readStepIds,
  ROW_KEY,
  type WizardDefinition,
} from '@r10c/entifix-ts-core';
import {
  useFollowWizardStepUrl,
  useWizardDraft,
  useWizardStepUrl,
} from '@r10c/shells-next-common';
import { useCallback, useEffect, useRef, useState } from 'react';

import { COUNTER_SALE_SURFACE } from '../sales-surfaces';
import { useSalesAdapters } from './sales-context';

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
      labelKey: 'shell:sales.counterSale.steps.channel',
      to: ['lines'],
    },
    {
      id: 'lines',
      kind: 'custom',
      labelKey: 'shell:sales.counterSale.steps.lines',
      to: ['payment'],
    },
    {
      id: 'payment',
      kind: 'custom',
      labelKey: 'shell:sales.counterSale.steps.payment',
      to: ['summary'],
    },
    {
      id: 'summary',
      kind: 'summary',
      labelKey: 'shell:sales.counterSale.steps.summary',
      to: [],
    },
  ],
};

assertWizardDefinition(COUNTER_SALE_WIZARD);

/** Where the flow begins — the first step declared, stated once. */
const ENTRY_STEP = 'channel';

/** How the money arrived. The set `Payment.paymentMethod` accepts. */
const PAYMENT_METHODS = ['cash', 'card', 'voucher', 'transfer'] as const;

/** One line of the sale, as the draft carries it — every value a string. */
interface Line {
  readonly key: string;
  readonly offeringId: string;
  readonly name: string;
  readonly amount: number;
  readonly currency: string;
  readonly quantity: number;
}

const readLines = (rows: readonly EntityRowDraft[]): readonly Line[] =>
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

const totalOf = (lines: readonly Line[]): number =>
  lines.reduce((sum, line) => sum + line.amount * line.quantity, 0);

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

  const channels = useDataLoading<SalesChannel, unknown>({
    uc: loadUCFactory<SalesChannel>(),
    ctx: adapters.salesChannelRest as never,
    initialPageSize: 50,
    queryKey: ['sales-channel', 'counter-sale'],
  });

  const offerings = useDataLoading<PublishedOffering, unknown>({
    uc: loadUCFactory<PublishedOffering>(),
    ctx: adapters.publishedOfferingRest as never,
    initialPageSize: 50,
    queryKey: ['published-offering', 'counter-sale'],
  });

  const [channelId] = readStepIds(state, 'channel');
  const lines = readLines(
    (readStepDraft(state, 'lines')['lines'] ??
      []) as readonly EntityRowDraft[],
  );
  const paymentMethod =
    (readStepDraft(state, 'payment')['paymentMethod'] as string) ?? 'cash';

  const [pendingOffering, setPendingOffering] = useState('');
  const [pendingQuantity, setPendingQuantity] = useState('1');
  const [receiptId, setReceiptId] = useState<string | undefined>(undefined);
  const [charging, setCharging] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);

  const save = draft.save;
  const setChannel = (id: string) =>
    save({
      ...state,
      steps: {
        ...state.steps,
        channel: { kind: 'selection', ids: id === '' ? [] : [id] },
      },
    });

  const setLines = (next: readonly Line[]) =>
    save({
      ...state,
      steps: {
        ...state.steps,
        lines: { kind: 'form', values: { lines: writeLines(next) } },
      },
    });

  const setPaymentMethod = (method: string) =>
    save({
      ...state,
      steps: {
        ...state.steps,
        payment: { kind: 'form', values: { paymentMethod: method } },
      },
    });

  const addLine = () => {
    const offering = offerings.items.find(
      candidate => candidate.offeringId === pendingOffering,
    );
    const quantity = Number(pendingQuantity);
    if (offering === undefined || !Number.isInteger(quantity) || quantity < 1) {
      return;
    }
    setLines([
      ...lines,
      {
        key: newRowKey(),
        offeringId: offering.offeringId,
        name: offering.name,
        amount: offering.amount,
        currency: offering.currency,
        quantity,
      },
    ]);
    setPendingOffering('');
    setPendingQuantity('1');
  };

  const charge = async () => {
    setCharging(true);
    setFailure(undefined);
    const response = await fetch('/api/sales/counter-sale', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        channelId,
        paymentMethod,
        lines: lines.map(line => ({
          offeringId: line.offeringId,
          quantity: line.quantity,
        })),
      }),
    }).catch(() => undefined);
    setCharging(false);

    if (response?.status === 201) {
      // The draft is cleared only once the sale is written: a till emptied
      // before the answer loses a basket the seller would otherwise retry.
      draft.clear();
      setReceiptId(String(Date.now()));
      return;
    }
    const body = (await response?.json().catch(() => undefined)) as
      | { code?: string }
      | undefined;
    setFailure(body?.code ?? 'unexpected');
  };

  const canAdvance =
    activeStep === 'channel'
      ? channelId !== undefined
      : activeStep === 'lines'
        ? lines.length > 0
        : true;

  if (receiptId !== undefined) {
    return (
      <Card>
        <Stack>
          <Text>{translateKey('shell:sales.counterSale.sold')}</Text>
          <Text>{translateKey('shell:sales.counterSale.soldDetail')}</Text>
          <Button
            onClick={() => {
              setReceiptId(undefined);
              goTo(ENTRY_STEP);
              onFinished?.();
            }}
          >
            {translateKey('shell:sales.counterSale.newSale')}
          </Button>
        </Stack>
      </Card>
    );
  }

  const stepIndex = COUNTER_SALE_WIZARD.steps.findIndex(
    candidate => candidate.id === activeStep,
  );

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
      title={translateKey('shell:sales.counterSale.title')}
      canFinish={activeStep === 'summary'}
      canAdvance={canAdvance}
      isSubmitting={charging}
      onNext={() => {
        const next = COUNTER_SALE_WIZARD.steps[stepIndex + 1];
        if (next) goTo(next.id);
      }}
      onPrevious={
        stepIndex > 0
          ? () => {
              const previous = COUNTER_SALE_WIZARD.steps[stepIndex - 1];
              if (previous) goTo(previous.id);
            }
          : undefined
      }
      onFinish={() => {
        void charge();
      }}
    >
      {activeStep === 'channel' && (
        <Stack>
          <Text>{translateKey('shell:sales.counterSale.channelHint')}</Text>
          <Select
            aria-label={translateKey('shell:sales.counterSale.steps.channel')}
            value={channelId ?? ''}
            onChange={event => setChannel(event.target.value)}
            disabled={channels.isLoading}
          >
            <option value="">—</option>
            {channels.items
              // A retired channel takes no sale, and the route refuses one, so
              // offering it here would be offering a dead end.
              .filter(channel => channel.status === 'active')
              .map(channel => (
                <option key={String(channel.id)} value={String(channel.id)}>
                  {channel.name}
                </option>
              ))}
          </Select>
        </Stack>
      )}

      {activeStep === 'lines' && (
        <Stack>
          <Text>{translateKey('shell:sales.counterSale.linesHint')}</Text>
          <Cluster>
            <Select
              aria-label={translateKey('shell:sales.counterSale.offering')}
              value={pendingOffering}
              onChange={event => setPendingOffering(event.target.value)}
              disabled={offerings.isLoading}
            >
              <option value="">—</option>
              {offerings.items.map(offering => (
                <option key={offering.offeringId} value={offering.offeringId}>
                  {offering.name}
                </option>
              ))}
            </Select>
            <TextInput
              aria-label={translateKey('shell:sales.counterSale.quantity')}
              type="number"
              min={1}
              value={pendingQuantity}
              onChange={event => setPendingQuantity(event.target.value)}
            />
            <Button onClick={addLine}>
              {translateKey('shell:sales.counterSale.addLine')}
            </Button>
          </Cluster>
          <Stack>
            {lines.map(line => (
              <Cluster key={line.key}>
                <Text>
                  {line.quantity} × {line.name}
                </Text>
                <Button
                  onClick={() =>
                    setLines(lines.filter(other => other.key !== line.key))
                  }
                >
                  {translateKey('shell:sales.counterSale.removeLine')}
                </Button>
              </Cluster>
            ))}
            {lines.length === 0 && (
              <Text>{translateKey('shell:sales.counterSale.emptyLines')}</Text>
            )}
          </Stack>
        </Stack>
      )}

      {activeStep === 'payment' && (
        <Stack>
          <Select
            aria-label={translateKey('shell:sales.counterSale.paymentMethod')}
            value={paymentMethod}
            onChange={event => setPaymentMethod(event.target.value)}
          >
            {PAYMENT_METHODS.map(method => (
              <option key={method} value={method}>
                {method}
              </option>
            ))}
          </Select>
        </Stack>
      )}

      {activeStep === 'summary' && (
        <Stack>
          {lines.map(line => (
            <Text key={line.key}>
              {line.quantity} × {line.name} — {line.amount * line.quantity}{' '}
              {line.currency}
            </Text>
          ))}
          <Text>
            {translateKey('shell:sales.counterSale.total')}:{' '}
            {totalOf(lines)} {lines[0]?.currency ?? ''}
          </Text>
          {failure !== undefined && <Text>{translateKey(`errors:${failure}`)}</Text>}
        </Stack>
      )}
    </Wizard>
  );
}
