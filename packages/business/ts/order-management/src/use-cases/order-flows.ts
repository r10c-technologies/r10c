import { createHash, randomUUID } from 'node:crypto';

import { IdempotencyKeyTag } from '@entifix/business';
import { NotFound } from '@entifix/core';
import { InvalidBody } from '@r10c/business-ts-common';
import { FlowStarterTag } from '@r10c/business-ts-flow-contracts';
import { ObjectStoreTag } from '@r10c/business-ts-object-storage';
import {
  decodeBuyerContact,
  drawOrderNumber,
  normalizeOrderNumber,
} from '@r10c/business-ts-order-contracts';
import {
  isPricePer,
  isSaleUnit,
  kitTakenOf,
  lineTotal,
} from '@r10c/business-ts-sales-vocabulary';
import { Context, Effect, Option } from 'effect';

import type { CheckoutGroup } from '../entities/checkout-group';
import type { ProductOrder } from '../entities/product-order';
import {
  CancelNotAuthorized,
  EvidenceLimitReached,
  EvidenceTooLarge,
  EvidenceTypeRefused,
  InvalidPaymentDetails,
  OrderNotAwaitingPayment,
  OrderNotTransitionable,
  PaymentPending,
} from '../failures/order-failures';
import {
  composeAccessLinkMail,
  composeReceiptMail,
} from '../notifications/receipt-mail';
import { BuyerNotifierTag } from '../ports/buyer-notifier';
import { PaymentLinkProvidersTag } from '../ports/payment-link-providers';
import {
  CheckoutGroupStoreTag,
  type OrderGuide,
  ProductOrderStoreTag,
} from '../ports/product-order-store';
import {
  AccessLinkHours,
  AccessLinkIntervalSeconds,
  type BuyerCapabilityHolder,
  type CapabilityRefusal,
  digestOf,
  isCapabilityDigest,
  mintAccessToken,
  StorefrontUrl,
  verifyCancelCapability,
  verifyReceiptCapability,
} from '../values/cancel-capability';
import { checkoutContactOf } from '../values/checkout-contact';
import type { OrderScope } from '../values/order-scope';
import type { OrderTransition } from '../values/order-transition';
import {
  EVIDENCE_PREFIX,
  type EvidenceAttacher,
  evidenceKeyOf,
  type EvidenceType,
  keptEvidence,
  PaymentEvidence,
  sniffEvidenceType,
} from '../values/payment-evidence';
import {
  type PaymentConfirmationPayload,
  paymentLinkOf,
  type PaymentLinkPayload,
  paymentReferenceOf,
} from '../values/payment-link';
import { CancelProductOrderUC } from './cancel-product-order';
import {
  AttachPaymentEvidenceUC,
  ConfirmPaymentUC,
  SetPaymentLinkUC,
} from './payment-link';

const MILLISECONDS = 1000;
/** A day, in milliseconds: `order.receiptDays` is counted in whole days. */
const HOUR_MILLISECONDS = 60 * 60 * MILLISECONDS;
const DAY_MILLISECONDS = 24 * HOUR_MILLISECONDS;

/** The recipe a cancellation runs on the coordinator. */
export const CANCELLATION_RECIPE = 'cancellation';

/** A group id is the checkout flow's id: a UUID, and nothing else. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * An order outside the caller's scope answers exactly as an absent one does:
 * telling a vendor another vendor's order exists is a leak.
 */
const orderNotFound = new NotFound({ entity: 'product-order' });

/** The order a staff verb acts on, when it is the caller's to act on. */
const orderInScope = (orderId: string, scope: OrderScope) =>
  Effect.gen(function* () {
    if (scope.kind === 'buyer' || scope.kind === 'nothing') {
      return yield* orderNotFound;
    }
    const store = yield* ProductOrderStoreTag;
    const order = yield* store.get(orderId);
    if (
      order === undefined ||
      (scope.kind === 'vendor' && order.vendorId !== scope.organizationId)
    ) {
      return yield* orderNotFound;
    }
    return order;
  });

/**
 * Open a checkout group — the checkout's first write, before any vendor's
 * order. The id is the flow's, handed in; the placing time, the buyer's
 * cancel window and how long their receipt can be read are this domain's to
 * stamp, and both windows open only for a group that carries a capability digest: a counter
 * sale has no buyer to hold one.
 */
export const openGroup = (input: {
  readonly group: CheckoutGroup;
  /**
   * The buyer's contact as the step carried it, nested, or `undefined` at a
   * counter. Checked here, where the order lives, against the same rules the
   * storefront's form answers from (ADR 0076 §2).
   */
  readonly contact?: unknown;
  readonly commandId: string | undefined;
  readonly cancelWindowSeconds: number;
  /** How long the buyer's capability may still read the receipt, in days. */
  readonly receiptDays: number;
}) =>
  Effect.gen(function* () {
    const { group } = input;
    if (typeof group.id !== 'string' || !UUID.test(group.id)) {
      return yield* new InvalidBody({
        reason: 'a checkout group is opened under its flow’s id',
      });
    }
    group.contact =
      input.contact === undefined
        ? []
        : [checkoutContactOf(yield* decodeBuyerContact(input.contact))];
    group.redactedAt = undefined;
    group.orderIds = [];
    group.number = drawOrderNumber();
    group.placedAt = new Date();
    const placedAt = group.placedAt.getTime();
    const capable =
      group.cancelDigest !== undefined && group.cancelDigest !== '';
    group.cancelWindowEndsAt = capable
      ? new Date(placedAt + input.cancelWindowSeconds * MILLISECONDS)
      : undefined;
    group.receiptEndsAt = capable
      ? new Date(placedAt + input.receiptDays * DAY_MILLISECONDS)
      : undefined;
    const groups = yield* CheckoutGroupStoreTag;
    return yield* groups.open(group, input.commandId);
  });

/**
 * Why a write's lines cannot be one vendor's order, or `undefined` when they
 * can. A line names no vendor once stored, but the write that carries it may —
 * the checkout prices each line from the published offering, vendor and all —
 * and a line naming another vendor is a basket split wrongly upstream.
 */
export const foreignLinesProblem = (
  vendorId: string,
  lines: readonly unknown[],
): string | undefined =>
  lines.some(line => {
    const named = (line as { vendorId?: unknown } | null)?.vendorId;
    return named !== undefined && named !== vendorId;
  })
    ? 'every line of an order must be its own vendor’s'
    : undefined;

/**
 * Why an order's lines do not state what they cost, or `undefined`. Each line
 * names its unit and its price basis, and its total is `lineTotal` over them —
 * computed once by the coordinator and checked here, never trusted blind, so
 * a line that lost its unit cannot be stored as one priced per piece
 * (ADR 0082 §6).
 */
export const lineTotalsProblem = (order: ProductOrder): string | undefined =>
  order.items.every(
    line =>
      isSaleUnit(line.saleUnit) &&
      isPricePer(line.pricePer) &&
      Number.isSafeInteger(line.amount) &&
      Number.isSafeInteger(line.quantity) &&
      line.amount >= 0 &&
      line.quantity > 0 &&
      line.lineTotal ===
        lineTotal({
          amount: line.amount,
          pricePer: line.pricePer,
          quantity: line.quantity,
          saleUnit: line.saleUnit,
        }),
  )
    ? undefined
    : 'every line states its unit, its price basis and the total they make';

/**
 * Why an order's fiscal facts cannot be stored as they were stated, or
 * `undefined`. They are recorded at placement or never (ADR 0078 §4), so an
 * order the coordinator stated without them — or whose lines do not add up to
 * the document — is refused rather than placed half-described.
 */
export const fiscalFactsProblem = (order: ProductOrder): string | undefined => {
  if (
    order.sellerTaxId === '' ||
    order.sellerLegalName === '' ||
    order.sellerEstablishmentCode === ''
  )
    return 'an order carries its seller’s fiscal identity';
  if (order.buyerTaxId === '')
    return 'an order names its buyer, or consumidor final';
  const gross = order.items.reduce((sum, line) => sum + line.lineTotal, 0);
  const tax = order.items.reduce((sum, line) => sum + line.taxAmount, 0);
  const base = order.items.reduce((sum, line) => sum + line.taxableBase, 0);
  if (
    order.totalAmount !== gross ||
    order.taxAmount !== tax ||
    order.netAmount !== base
  )
    return 'an order’s lines add up to its document';
  return undefined;
};

/**
 * Place one vendor's order — the checkout's per-vendor write — into a group
 * already opened. The id, the status and the placing time are this domain's
 * to write, never the caller's.
 */
export const placeOrder = (input: {
  readonly order: ProductOrder;
  readonly rawLines: readonly unknown[];
  readonly commandId: string | undefined;
}) =>
  Effect.gen(function* () {
    const { order } = input;
    if (order.items.length === 0) {
      return yield* new InvalidBody({
        reason: 'an order must carry at least one item',
      });
    }
    if (order.vendorId === '' || order.groupId === '') {
      return yield* new InvalidBody({
        reason: 'an order belongs to one vendor in one checkout group',
      });
    }
    const foreign = foreignLinesProblem(order.vendorId, input.rawLines);
    if (foreign !== undefined)
      return yield* new InvalidBody({ reason: foreign });
    const totals = lineTotalsProblem(order);
    if (totals !== undefined) return yield* new InvalidBody({ reason: totals });
    const fiscal = fiscalFactsProblem(order);
    if (fiscal !== undefined) return yield* new InvalidBody({ reason: fiscal });

    order.id = globalThis.crypto.randomUUID();
    order.number = drawOrderNumber();
    order.status = 'pending';
    order.placedAt = new Date();

    const store = yield* ProductOrderStoreTag;
    return yield* store.place(order, input.commandId);
  });

/**
 * One crossing move a flow makes on a vendor's order — confirm it, mark it
 * dispatched, close it — conditional on where it stands, and refused when it
 * stands anywhere else.
 */
export const moveOrder = (input: {
  readonly orderId: string;
  readonly transition: Exclude<
    OrderTransition,
    | 'claim-cancel'
    | 'settle-cancel'
    | 'await-payment'
    | 'confirm-payment'
    | 'end-awaiting-payment'
  >;
  readonly commandId: string | undefined;
  readonly guide?: OrderGuide;
}) =>
  Effect.gen(function* () {
    const store = yield* ProductOrderStoreTag;
    const moved = yield* store.move(
      input.orderId,
      input.transition,
      input.commandId,
      input.guide,
    );
    if (moved !== undefined) return moved;
    const order = yield* store.get(input.orderId);
    if (order === undefined) return yield* orderNotFound;
    return yield* new OrderNotTransitionable({
      orderId: input.orderId,
      standing: order.status,
      transition: input.transition,
    });
  });

/**
 * What the cancellation flow starts from, all of it read off the stored order —
 * which is the authority on it: the order, its vendor, how it was paid, the
 * lines to put back, and whether a shipment was opened for it. A sale handed
 * over at a counter shipped nothing; the coordinator narrows the rest by
 * whether the vendor ships at all. The organization comes from the *order*,
 * because the buyer behind a cancellation names none.
 */
export const cancellationInput = (
  order: ProductOrder,
  capabilityDigest?: string,
) => ({
  orderId: String(order.id),
  vendorId: order.vendorId,
  paymentMethod: order.paymentMethod,
  // A presentation's line puts back what it took from its base (ADR 0082 §7),
  // and a kit's what it took from each component (ADR 0086).
  lines: order.items.map(line => ({
    offeringId: line.offeringId,
    unit: line.saleUnit,
    quantity: line.quantity,
    ...(line.stockOfferingId === undefined
      ? {}
      : {
          stockOfferingId: line.stockOfferingId,
          stockUnit: line.stockUnit,
          stockQuantity: line.stockQuantity,
        }),
    ...kitTakenOf(line),
  })),
  shipped: order.channel === undefined || order.channel.type === 'storefront',
  ...(order.buyerId === undefined ? {} : { buyerId: order.buyerId }),
  ...(capabilityDigest === undefined ? {} : { capabilityDigest }),
});

/**
 * Start the cancellation flow, having already decided the caller may, and
 * answer the flow to follow — never its outcome (ADR 0066, ADR 0073). A
 * refused refund or an order already past cancelling arrives as the flow's
 * failure.
 *
 * Keyed on the order **and** on the request: the caller's `Idempotency-Key`
 * when it sent one, so a retried request is the same flow, and a fresh key
 * otherwise. Never on the order alone — a cancellation whose refund was
 * declined must be askable again. Two starts racing on one order are safe,
 * because the claim is the lock: the second fails there and moves nothing.
 *
 * ⚠️ **This service is both the caller and a participant**, the cycle ADR 0058
 * §6 accepts: a cancellation's authority is a buyer's capability or a vendor's
 * session, and neither is verifiable anywhere but here.
 */
const startCancellation = (order: ProductOrder, capabilityDigest?: string) =>
  Effect.gen(function* () {
    const requestKey = Option.getOrUndefined(
      yield* Effect.serviceOption(IdempotencyKeyTag),
    );
    const flows = yield* FlowStarterTag;
    return yield* flows.start(
      CANCELLATION_RECIPE,
      cancellationInput(order, capabilityDigest),
      `cancellation:${String(order.id)}:${requestKey ?? globalThis.crypto.randomUUID()}`,
    );
  });

/**
 * A vendor or an operator cancelling one vendor order — the vendor's own,
 * since the narrowing never shows them another's.
 */
export const cancelOrderAsStaff = (input: {
  readonly orderId: string;
  readonly scope: OrderScope;
}) =>
  Effect.gen(function* () {
    const order = yield* orderInScope(input.orderId, input.scope);
    yield* CancelProductOrderUC.run(order);
    return yield* startCancellation(order);
  });

/**
 * The group a buyer's capability opens, with nothing told about why it did not:
 * every capability failure answers alike, because saying which part was wrong
 * would teach a caller how to forge the rest.
 */
const groupForBuyer = (
  groupId: string,
  nonce: string | undefined,
  verify: (
    group: BuyerCapabilityHolder,
    nonce: string | undefined,
    now: Date,
  ) => CapabilityRefusal | undefined,
) =>
  Effect.gen(function* () {
    const groups = yield* CheckoutGroupStoreTag;
    const group = yield* groups.get(groupId);
    const refusal =
      group === undefined ? 'noCapability' : verify(group, nonce, new Date());
    if (group === undefined || refusal !== undefined) {
      // On the trace rather than in a log: the failure is the answer, and only
      // the slice shell logs (ADR 0064).
      yield* Effect.annotateCurrentSpan({
        'checkout-group.id': groupId,
        'checkout-group.capability.refusal': String(refusal),
      });
      return yield* new CancelNotAuthorized();
    }
    return group;
  });

/**
 * A buyer cancelling one vendor order with the capability their receipt
 * carried — the group's — and no session at all.
 *
 * An order still waiting for its payment link took no money, so it is
 * withdrawn by one conditional write rather than a cancellation flow — the
 * same write an expiry makes, so of the two exactly one wins — and the
 * checkout that waited on it lets its stock go (ADR 0081 §4).
 */
export const cancelOrderAsBuyer = (input: {
  readonly orderId: string;
  readonly nonce: string | undefined;
  /** The digest of the capability the buyer follows this cancellation by. */
  readonly capabilityDigest?: string;
}) =>
  Effect.gen(function* () {
    const store = yield* ProductOrderStoreTag;
    const order = yield* store.get(input.orderId);
    if (order === undefined) return yield* new CancelNotAuthorized();
    yield* groupForBuyer(order.groupId, input.nonce, verifyCancelCapability);
    // The payment is not confirmed yet: a state the buyer can wait out.
    if (order.status === 'pending') {
      return yield* new PaymentPending({ orderId: input.orderId });
    }
    let current = order;
    if (order.status === 'awaiting-payment') {
      const withdrawn = yield* store.endAwaitingPayment(
        input.orderId,
        'buyer',
        new Date(),
      );
      if (withdrawn !== undefined) {
        return { _tag: 'withdrawn' as const, order: withdrawn };
      }
      // Confirmed or expired a moment ago: answered as it now stands.
      current = (yield* store.get(input.orderId)) as ProductOrder;
    }
    yield* CancelProductOrderUC.run(current);
    return {
      _tag: 'started' as const,
      accepted: yield* startCancellation(current, input.capabilityDigest),
    };
  });

/**
 * The buyer's receipt read back by the same capability, with no session: the
 * group and every vendor order in it. What a storefront that waited on a flow
 * reads once the flow completed, knowing only the flow's id — which is the
 * group's (ADR 0053, as revised by ADR 0069).
 */
export const buyerReceipt = (input: {
  readonly groupId: string;
  readonly nonce: string | undefined;
}) =>
  Effect.gen(function* () {
    const group = yield* groupForBuyer(
      input.groupId,
      input.nonce,
      verifyReceiptCapability,
    );
    const store = yield* ProductOrderStoreTag;
    const orders = yield* store.forGroup(input.groupId);
    return { group, orders };
  });

/**
 * Mint a fresh one-time access link for a group and store only its digest,
 * replacing any earlier link (ADR 0076 §6). With `notSentSince`, only when no
 * link went out after it. Answers the token **for the mail alone** — it must
 * never reach a step outcome, the journal or a log — or `undefined` when the
 * group does not exist or the interval had not passed.
 */
export const issueAccessLink = (input: {
  readonly groupId: string;
  readonly notSentSince?: Date;
}) =>
  Effect.gen(function* () {
    const hours = yield* AccessLinkHours;
    const groups = yield* CheckoutGroupStoreTag;
    const token = mintAccessToken();
    const now = new Date();
    const group = yield* groups.issueAccess(
      input.groupId,
      {
        digest: digestOf(token),
        expiresAt: new Date(now.getTime() + hours * HOUR_MILLISECONDS),
        sentAt: now,
      },
      input.notSentSince,
    );
    return group === undefined ? undefined : { group, token };
  });

/**
 * Redeem a mailed access link into a fresh capability: the storefront minted
 * a new nonce and sends its digest, and one conditional write swaps it in for
 * the group's cancel digest and spends the link (ADR 0076 §6). The token is
 * the whole credential — no session — so a wrong, spent or expired one is
 * refused exactly as a bad nonce is.
 */
export const redeemAccess = (input: {
  readonly token: unknown;
  readonly capabilityDigest: unknown;
}) =>
  Effect.gen(function* () {
    const { token, capabilityDigest } = input;
    if (
      typeof token !== 'string' ||
      token === '' ||
      !isCapabilityDigest(capabilityDigest)
    ) {
      return yield* new CancelNotAuthorized();
    }
    const groups = yield* CheckoutGroupStoreTag;
    const groupId = yield* groups.redeemAccess(
      digestOf(token),
      capabilityDigest,
      new Date(),
    );
    if (groupId === undefined) return yield* new CancelNotAuthorized();
    return { id: groupId };
  });

/** The address a mailed token opens, on the storefront, in the buyer's locale. */
const accessLinkOf = (group: CheckoutGroup, token: string) =>
  Effect.map(
    StorefrontUrl,
    origin =>
      `${origin}/${group.locale === 'en' ? 'en' : 'es'}/order/access?token=${encodeURIComponent(token)}`,
  );

/**
 * The last step of a storefront checkout (`order.notify-buyer`): mint a fresh
 * access link, store its digest, and mail the buyer their receipt with it
 * (ADR 0076 §6). A retry draws a new link and sends again — at-least-once,
 * and only the latest link opens anything.
 *
 * ⚠️ **The answer carries no token.** It is a step outcome, so it lands in the
 * workflow journal and in flow-status; the token exists only in the mail.
 */
export const sendReceiptMail = (input: { readonly groupId: string }) =>
  Effect.gen(function* () {
    const issued = yield* issueAccessLink({ groupId: input.groupId });
    if (issued === undefined) {
      return yield* new NotFound({ entity: 'checkout-group' });
    }
    // A counter sale, or a contact already removed: nobody to write to.
    if (issued.group.contact.length === 0) {
      return { id: input.groupId, outcome: 'no-contact' as const };
    }
    const orders = yield* (yield* ProductOrderStoreTag).forGroup(input.groupId);
    const mail = composeReceiptMail({
      group: issued.group,
      orders,
      link: yield* accessLinkOf(issued.group, issued.token),
      linkHours: yield* AccessLinkHours,
    }) as NonNullable<ReturnType<typeof composeReceiptMail>>;
    yield* (yield* BuyerNotifierTag).send(mail);
    return { id: input.groupId, outcome: 'sent' as const };
  });

/** An email as the contact stores it: trimmed and lower-cased. */
const normalizedEmail = (email: unknown) =>
  typeof email === 'string' ? email.trim().toLowerCase() : '';

/**
 * "Find my order" (ADR 0076 §6): given a number — the group's or one seller's
 * — and an email, mail a fresh access link **to the email on file** when the
 * two match and no link went out within `order.accessLinkIntervalSeconds`.
 *
 * ⚠️ **It answers nothing about the match.** Whatever happened — no such
 * number, another email, a link sent a minute ago, a mail server that did not
 * answer — the caller receives the same thing, so the route is not an oracle
 * for which numbers or emails exist. What happened is on the trace.
 */
export const sendAccessLink = (input: {
  readonly number: unknown;
  readonly email: unknown;
}) =>
  Effect.gen(function* () {
    const number =
      typeof input.number === 'string'
        ? normalizeOrderNumber(input.number)
        : undefined;
    const email = normalizedEmail(input.email);
    const outcome = yield* Effect.gen(function* () {
      if (number === undefined || email === '') return 'malformed';
      const groups = yield* CheckoutGroupStoreTag;
      const group = yield* groups.findByNumber(number);
      if (group === undefined || group.contact[0]?.email !== email) {
        return 'no-match';
      }
      const interval = yield* AccessLinkIntervalSeconds;
      const issued = yield* issueAccessLink({
        groupId: String(group.id),
        notSentSince: new Date(Date.now() - interval * MILLISECONDS),
      });
      if (issued === undefined) return 'too-soon';
      const mail = composeAccessLinkMail({
        group: issued.group,
        link: yield* accessLinkOf(issued.group, issued.token),
        linkHours: yield* AccessLinkHours,
      }) as NonNullable<ReturnType<typeof composeAccessLinkMail>>;
      return yield* (yield* BuyerNotifierTag).send(mail).pipe(
        Effect.as('sent'),
        Effect.catchTag('Unavailable', () => Effect.succeed('unsent')),
      );
    });
    yield* Effect.annotateCurrentSpan({ 'checkout-group.lookup': outcome });
    return { accepted: true as const };
  });

/** The refusal an order that did not move answers, read off where it stands. */
const notAwaiting = (orderId: string) =>
  Effect.gen(function* () {
    const order = yield* (yield* ProductOrderStoreTag).get(orderId);
    if (order === undefined) return yield* orderNotFound;
    return yield* new OrderNotAwaitingPayment({
      orderId,
      standing: order.status,
    });
  });

/**
 * A payment-link order's commit point (`order.await-payment`): it waits for
 * its payment until `now + paymentWindowMs`. The window is the coordinator's
 * to state from its one configuration row, and the stamp this domain's —
 * order-service holds no row of its own for it, since two rows meaning one
 * number drift (ADR 0081 §3).
 */
export const awaitPayment = (input: {
  readonly orderId: string;
  readonly paymentWindowMs: unknown;
  readonly commandId: string | undefined;
}) =>
  Effect.gen(function* () {
    const window = input.paymentWindowMs;
    if (
      typeof window !== 'number' ||
      !Number.isInteger(window) ||
      window <= 0
    ) {
      return yield* new InvalidBody({
        reason: 'a payment window is a positive number of milliseconds',
      });
    }
    const store = yield* ProductOrderStoreTag;
    const moved = yield* store.awaitPayment(
      input.orderId,
      new Date(Date.now() + window),
      input.commandId,
    );
    if (moved !== undefined) return moved;
    const order = yield* store.get(input.orderId);
    if (order === undefined) return yield* orderNotFound;
    return yield* new OrderNotTransitionable({
      orderId: input.orderId,
      standing: order.status,
      transition: 'await-payment',
    });
  });

/**
 * The seller confirms a payment link was paid (`confirm-payment`): one
 * conditional write on `awaiting-payment`, announced as
 * `order.payment-confirmed`. A confirmation that lost to an expiry or a
 * withdrawal is refused `orderNotAwaitingPayment` (ADR 0081 §4).
 */
export const confirmPayment = (input: {
  readonly orderId: string;
  readonly scope: OrderScope;
  readonly payload: PaymentConfirmationPayload;
  readonly confirmedBy: string;
}) =>
  Effect.gen(function* () {
    const order = yield* orderInScope(input.orderId, input.scope);
    yield* ConfirmPaymentUC.run(order);
    const reference = paymentReferenceOf(input.payload);
    if (!reference.ok) {
      return yield* new InvalidPaymentDetails({
        field: reference.field,
        reason: reference.reason,
      });
    }
    const store = yield* ProductOrderStoreTag;
    const confirmed = yield* store.confirmPayment(input.orderId, {
      reference: reference.value,
      confirmedBy: input.confirmedBy,
      confirmedAt: new Date(),
    });
    return confirmed ?? (yield* notAwaiting(input.orderId));
  });

/**
 * The seller sets the link the buyer pays by (`set-payment-link`), checked
 * against the provider dictionary; the last one set wins (ADR 0081 §10).
 */
export const setPaymentLink = (input: {
  readonly orderId: string;
  readonly scope: OrderScope;
  readonly payload: PaymentLinkPayload;
  readonly setBy: string;
}) =>
  Effect.gen(function* () {
    const order = yield* orderInScope(input.orderId, input.scope);
    yield* SetPaymentLinkUC.run(order);
    const link = paymentLinkOf(input.payload, yield* PaymentLinkProvidersTag);
    if (!link.ok) {
      return yield* new InvalidPaymentDetails({
        field: link.field,
        reason: link.reason,
      });
    }
    const store = yield* ProductOrderStoreTag;
    const set = yield* store.setPaymentLink(input.orderId, {
      ...link.value,
      setBy: input.setBy,
      setAt: new Date(),
    });
    return set ?? (yield* notAwaiting(input.orderId));
  });

/**
 * One pass of the payment-expiry sweep: every order still waiting past its
 * window is cancelled, each by its own conditional write, so a confirmation
 * landing in between wins that order and the sweep moves on (ADR 0081 §4).
 * Answers how many it expired.
 */
export const expireOverduePayments = (now: Date) =>
  Effect.gen(function* () {
    const store = yield* ProductOrderStoreTag;
    const overdue = yield* store.overduePayments(now);
    let expired = 0;
    for (const orderId of overdue) {
      const ended = yield* store.endAwaitingPayment(
        orderId,
        'payment-expired',
        now,
      );
      if (ended !== undefined) expired += 1;
    }
    return expired;
  });

/**
 * The two dials on a payment receipt (ADR 0081 §7): its size and how many one
 * order holds — `order / evidenceMaxBytes` and `order / evidenceMaxCount`.
 */
export class EvidenceLimits extends Context.Service<
  EvidenceLimits,
  { readonly maxBytes: number; readonly maxCount: number }
>()('EvidenceLimits') {}

/** The file a receipt read answers: its bytes, as the bytes say they are. */
export interface EvidenceFile {
  readonly bytes: Uint8Array;
  readonly contentType: EvidenceType;
}

const evidenceNotFound = new NotFound({ entity: 'payment-evidence' });

/**
 * Attach a receipt to an order that waits for its payment (ADR 0081 §6, §7).
 * The bytes are sniffed — the declared type and the extension are ignored —
 * and written first, under a fresh key; then one conditional append on
 * `awaiting-payment` and the count decides. When it refuses, the object goes
 * in the same request, and the orphan sweep removes any a crash left behind.
 * The same file attached twice answers the first attachment rather than
 * spending a second slot: a retried upload is not a second receipt.
 */
const attachEvidence = (
  order: ProductOrder,
  bytes: Uint8Array,
  attachedBy: EvidenceAttacher,
) =>
  Effect.gen(function* () {
    const limits = yield* EvidenceLimits;
    const contentType = sniffEvidenceType(bytes);
    if (contentType === undefined) return yield* new EvidenceTypeRefused();
    if (bytes.length > limits.maxBytes)
      return yield* new EvidenceTooLarge({ maxBytes: limits.maxBytes });
    yield* AttachPaymentEvidenceUC.run(order);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const kept = keptEvidence(order.paymentEvidence);
    if (kept.some(entry => entry.sha256 === sha256)) return order;
    if (order.paymentEvidence.length >= limits.maxCount)
      return yield* new EvidenceLimitReached({ maxCount: limits.maxCount });

    const id = randomUUID();
    const objectKey = evidenceKeyOf(String(order.id), id);
    const objects = yield* ObjectStoreTag;
    yield* objects.put(objectKey, bytes, contentType);
    const store = yield* ProductOrderStoreTag;
    const appended = yield* store.appendEvidence(
      String(order.id),
      Object.assign(new PaymentEvidence(), {
        id,
        objectKey,
        contentType,
        byteSize: bytes.length,
        sha256,
        attachedBy,
        attachedAt: new Date(),
      }),
      limits.maxCount,
    );
    if (appended !== undefined) return appended;
    // Lost to a cancellation, an expiry or another attach: the bytes go now.
    yield* objects.delete(objectKey);
    const current = yield* store.get(String(order.id));
    if (current?.status === 'awaiting-payment')
      return yield* new EvidenceLimitReached({ maxCount: limits.maxCount });
    return yield* notAwaiting(String(order.id));
  });

/** A receipt's bytes, when the order keeps it and the store still has them. */
const evidenceFileOf = (order: ProductOrder, evidenceId: string) =>
  Effect.gen(function* () {
    const entry = keptEvidence(order.paymentEvidence).find(
      candidate => candidate.id === evidenceId,
    );
    if (entry?.objectKey === undefined) return yield* evidenceNotFound;
    const objects = yield* ObjectStoreTag;
    const found = yield* objects.get(entry.objectKey);
    if (found === undefined) return yield* evidenceNotFound;
    return {
      bytes: found.bytes,
      contentType: entry.contentType,
    } as EvidenceFile;
  });

/** The order a buyer's receipt capability opens, read before any check on it. */
const orderForBuyer = (orderId: string, nonce: string | undefined) =>
  Effect.gen(function* () {
    const store = yield* ProductOrderStoreTag;
    const order = yield* store.get(orderId);
    if (order === undefined) return yield* new CancelNotAuthorized();
    yield* groupForBuyer(order.groupId, nonce, verifyReceiptCapability);
    return order;
  });

/**
 * The buyer attaches a receipt by the capability their receipt carries, with
 * no session, for as long as the receipt can be read (ADR 0081 §6).
 */
export const attachEvidenceAsBuyer = (input: {
  readonly orderId: string;
  readonly nonce: string | undefined;
  readonly bytes: Uint8Array;
}) =>
  Effect.flatMap(orderForBuyer(input.orderId, input.nonce), order =>
    attachEvidence(order, input.bytes, 'buyer'),
  );

/** The seller attaches a receipt that reached them by another channel. */
export const attachEvidenceAsVendor = (input: {
  readonly orderId: string;
  readonly scope: OrderScope;
  readonly bytes: Uint8Array;
}) =>
  Effect.flatMap(orderInScope(input.orderId, input.scope), order =>
    attachEvidence(order, input.bytes, 'vendor'),
  );

/** A receipt read back by the buyer's capability. */
export const evidenceForBuyer = (input: {
  readonly orderId: string;
  readonly evidenceId: string;
  readonly nonce: string | undefined;
}) =>
  Effect.flatMap(orderForBuyer(input.orderId, input.nonce), order =>
    evidenceFileOf(order, input.evidenceId),
  );

/** A receipt read by the seller or an operator, narrowed as every order read. */
export const evidenceForStaff = (input: {
  readonly orderId: string;
  readonly evidenceId: string;
  readonly scope: OrderScope;
}) =>
  Effect.flatMap(orderInScope(input.orderId, input.scope), order =>
    evidenceFileOf(order, input.evidenceId),
  );

/**
 * One pass of the receipt-retention sweep (ADR 0076 §4, ADR 0081 §9): remove
 * the buyer's contact from every group whose receipt ended with all its
 * orders closed, then the payment receipts of those orders. The records keep
 * their facts and lose their keys first, so a file whose delete fails here is
 * no longer pointed at, and the orphan sweep takes it. Answers how many groups
 * it redacted.
 */
export const redactEndedReceipts = (now: Date) =>
  Effect.gen(function* () {
    const groups = yield* CheckoutGroupStoreTag;
    const store = yield* ProductOrderStoreTag;
    const objects = yield* ObjectStoreTag;
    const redacted = yield* groups.redactEndedReceipts(now);
    for (const groupId of redacted)
      for (const key of yield* store.redactEvidence(groupId, now))
        yield* objects.delete(key);
    return redacted.length;
  });

/**
 * One pass of the orphan sweep (ADR 0081 §6): delete every receipt file older
 * than `graceMs` that no order points at — the bytes an attach wrote before a
 * crash, or a delete the redaction sweep could not finish. The grace is what
 * keeps a file whose record is still being written from being swept under it.
 * Answers how many it deleted.
 */
export const sweepOrphanEvidence = (now: Date, graceMs: number) =>
  Effect.gen(function* () {
    const objects = yield* ObjectStoreTag;
    const store = yield* ProductOrderStoreTag;
    const listed = yield* objects.list(
      EVIDENCE_PREFIX,
      new Date(now.getTime() - graceMs),
    );
    if (listed.length === 0) return 0;
    const referenced = yield* store.referencedEvidence(
      listed.map(object => object.key),
    );
    const orphans = listed.filter(object => !referenced.has(object.key));
    for (const orphan of orphans) yield* objects.delete(orphan.key);
    return orphans.length;
  });
