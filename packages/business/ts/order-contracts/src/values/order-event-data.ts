/** A stored or serialized vendor order, as a store hands it to an event. */
type OrderRecord = Readonly<Record<string, unknown>>;

const LINE_MEMBERS = [
  'offeringId',
  'name',
  'description',
  'specificationId',
  'specificationVersion',
  'saleUnit',
  'quantity',
  'amount',
  'pricePer',
  'lineTotal',
  'currency',
  'kind',
  'taxTreatment',
  'taxRate',
  'taxableBase',
  'taxAmount',
] as const;

const ORDER_MEMBERS = [
  'id',
  'number',
  'buyerId',
  'vendorId',
  'groupId',
  'paymentMethod',
  'channel',
  'status',
  'placedAt',
  'paidAt',
  // A payment link's confirmation: the seller's authorization number and when
  // they confirmed it — the fact `order.payment-confirmed` states (ADR 0081 §4).
  // Who confirmed stays on the order; a person's id is not a bus fact.
  'paymentReference',
  'paymentConfirmedAt',
  // Why an order was cancelled: the buyer, the seller, a lapsed payment window.
  'cancelCause',
  'netAmount',
  'taxAmount',
  'totalAmount',
  'currency',
] as const;

const pick = (
  record: OrderRecord,
  members: readonly string[],
): Record<string, unknown> =>
  Object.fromEntries(
    members
      .filter(member => record[member] !== undefined)
      .map(member => [member, record[member]]),
  );

/**
 * The `data` of an `order.*` event, **built member by member** from the order
 * rather than the serialized entity (ADR 0078 §2): whatever the entity gains
 * reaches no subscriber until it is named here, which is a reviewed line.
 *
 * ⚠️ **The buyer's fiscal identity is never named.** A NIT is personal data,
 * and `order.*` reaches every subscriber and a vendor's open tabs; it rides
 * only the fiscal-document event, once something issues one. The seller's
 * identity is a fact of the sale and travels as `sellerTax`.
 */
export const orderEventDataOf = (
  order: OrderRecord,
): Record<string, unknown> => {
  const items = Array.isArray(order['items'])
    ? (order['items'] as readonly OrderRecord[]).map(line =>
        pick(line, LINE_MEMBERS),
      )
    : [];
  return {
    ...pick(order, ORDER_MEMBERS),
    items,
    sellerTax: {
      taxId: order['sellerTaxId'],
      legalName: order['sellerLegalName'],
      taxRegime: order['sellerTaxRegime'],
      establishmentCode: order['sellerEstablishmentCode'],
    },
  };
};
