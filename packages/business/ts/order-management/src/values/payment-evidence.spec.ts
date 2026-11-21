import { describe, expect, it } from 'vitest';

import {
  evidenceKeyOf,
  keptEvidence,
  PaymentEvidence,
  sniffEvidenceType,
} from './payment-evidence.js';

const bytes = (...values: number[]) => new Uint8Array(values);
const text = (value: string) => new TextEncoder().encode(value);

describe('sniffEvidenceType', () => {
  it('reads JPEG, PNG, WebP and PDF from their first bytes', () => {
    expect(sniffEvidenceType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
    expect(
      sniffEvidenceType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)),
    ).toBe('image/png');
    expect(sniffEvidenceType(text('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(sniffEvidenceType(text('%PDF-1.4'))).toBe('application/pdf');
  });

  it('refuses what a browser would execute, and what is too short to tell', () => {
    expect(
      sniffEvidenceType(text('<svg xmlns="http://www.w3.org/2000/svg"/>')),
    ).toBe(undefined);
    expect(sniffEvidenceType(text('<!doctype html><script>'))).toBe(undefined);
    expect(sniffEvidenceType(text('RIFF\0\0\0\0WAVE'))).toBe(undefined);
    expect(sniffEvidenceType(bytes(0xff))).toBe(undefined);
    expect(sniffEvidenceType(bytes())).toBe(undefined);
  });
});

describe('a receipt record', () => {
  it('keys its file under the order, and counts as kept only while it has one', () => {
    const kept = Object.assign(new PaymentEvidence(), {
      id: 'e-1',
      objectKey: evidenceKeyOf('o-1', 'e-1'),
    });
    const gone = Object.assign(new PaymentEvidence(), {
      id: 'e-2',
      redactedAt: new Date(),
    });

    expect(kept.objectKey).toBe('evidence/o-1/e-1');
    expect(keptEvidence([kept, gone])).toEqual([kept]);
    expect(keptEvidence(undefined)).toEqual([]);
    expect(gone).toMatchObject({
      contentType: 'application/pdf',
      byteSize: 0,
      sha256: '',
      attachedBy: 'buyer',
      attachedAt: undefined,
    });
  });
});
