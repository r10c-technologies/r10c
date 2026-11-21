import { accessor } from '@entifix/core';

/** Who attached a payment receipt (ADR 0081 §6). */
export const EvidenceAttachers = ['buyer', 'vendor'] as const;
export type EvidenceAttacher = (typeof EvidenceAttachers)[number];

/** The four media types a receipt may be, decided by its bytes (§7). */
export const EvidenceTypes = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;
export type EvidenceType = (typeof EvidenceTypes)[number];

const startsWith = (bytes: Uint8Array, signature: readonly number[], at = 0) =>
  bytes.length >= at + signature.length &&
  signature.every((byte, index) => bytes[at + index] === byte);

/** `RIFF` … `WEBP`, the container a WebP image sits in. */
const isWebp = (bytes: Uint8Array) =>
  startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
  startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8);

/**
 * The type a receipt's **bytes** say it is, or `undefined` for anything else
 * — whatever `Content-Type` or extension it arrived with (ADR 0081 §7). A
 * renamed SVG or an HTML page says nothing a browser would execute here,
 * because it is refused before it is stored.
 */
export const sniffEvidenceType = (
  bytes: Uint8Array,
): EvidenceType | undefined => {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return 'image/png';
  if (isWebp(bytes)) return 'image/webp';
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]))
    return 'application/pdf';
  return undefined;
};

/** Where a receipt's bytes live in the `payment-evidence` store. */
export const evidenceKeyOf = (orderId: string, evidenceId: string): string =>
  `${EVIDENCE_PREFIX}${orderId}/${evidenceId}`;

/** Every receipt's key starts here, which is what the orphan sweep lists. */
export const EVIDENCE_PREFIX = 'evidence/';

/**
 * One payment receipt attached to a vendor order (ADR 0081 §6): the record of
 * the attachment, never the file. The bytes sit in the `payment-evidence`
 * store under `objectKey`; this travels on no event, and once the buyer's
 * personal data is deleted it keeps its facts and loses its key (§9).
 *
 * A value on `ProductOrder`'s composition, like {@link OrderItem}: described by
 * its accessors and read as a plain object off the wire.
 */
export class PaymentEvidence {
  // #region properties
  #id = '';
  #objectKey?: string;
  #contentType: EvidenceType = 'application/pdf';
  #byteSize = 0;
  #sha256 = '';
  #attachedBy: EvidenceAttacher = 'buyer';
  #attachedAt?: Date;
  #redactedAt?: Date;
  // #endregion

  @accessor({
    type: 'string',
    labelKey: 'entity:product-order.fields.evidence.id',
  })
  get id(): string {
    return this.#id;
  }
  set id(value: string) {
    this.#id = value;
  }

  /** Absent once the file was deleted with the buyer's personal data (§9). */
  @accessor({
    type: 'string',
    labelKey: 'entity:product-order.fields.evidence.objectKey',
  })
  get objectKey(): string | undefined {
    return this.#objectKey;
  }
  set objectKey(value: string | undefined) {
    this.#objectKey = value;
  }

  @accessor({
    type: 'string',
    labelKey: 'entity:product-order.fields.evidence.contentType',
  })
  get contentType(): EvidenceType {
    return this.#contentType;
  }
  set contentType(value: EvidenceType) {
    this.#contentType = value;
  }

  @accessor({
    type: 'number',
    labelKey: 'entity:product-order.fields.evidence.byteSize',
  })
  get byteSize(): number {
    return this.#byteSize;
  }
  set byteSize(value: number) {
    this.#byteSize = value;
  }

  @accessor({
    type: 'string',
    labelKey: 'entity:product-order.fields.evidence.sha256',
  })
  get sha256(): string {
    return this.#sha256;
  }
  set sha256(value: string) {
    this.#sha256 = value;
  }

  @accessor({
    type: 'string',
    labelKey: 'entity:product-order.fields.evidence.attachedBy',
  })
  get attachedBy(): EvidenceAttacher {
    return this.#attachedBy;
  }
  set attachedBy(value: EvidenceAttacher) {
    this.#attachedBy = value;
  }

  @accessor({
    type: 'date',
    labelKey: 'entity:product-order.fields.evidence.attachedAt',
  })
  get attachedAt(): Date | undefined {
    return this.#attachedAt;
  }
  set attachedAt(value: Date | undefined) {
    this.#attachedAt = value;
  }

  @accessor({
    type: 'date',
    labelKey: 'entity:product-order.fields.evidence.redactedAt',
  })
  get redactedAt(): Date | undefined {
    return this.#redactedAt;
  }
  set redactedAt(value: Date | undefined) {
    this.#redactedAt = value;
  }
}

/** The receipts of an order whose file is still kept. */
export const keptEvidence = (
  evidence: readonly PaymentEvidence[] | undefined,
): readonly PaymentEvidence[] =>
  (evidence ?? []).filter(entry => entry.objectKey !== undefined);
