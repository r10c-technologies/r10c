import { receiptEvidenceResponse } from '@r10c/shells-next-marketplace/server';

/**
 * A payment receipt the buyer attached, read back on the storefront's own
 * origin by the receipt cookie's capability (ADR 0081 §7). Never cached: each
 * read passes the credential check.
 */
export async function GET(
  _request: Request,
  {
    params,
  }: {
    readonly params: Promise<{
      readonly orderId: string;
      readonly evidenceId: string;
    }>;
  },
): Promise<Response> {
  const { orderId, evidenceId } = await params;
  return receiptEvidenceResponse(
    decodeURIComponent(orderId),
    decodeURIComponent(evidenceId),
  );
}
