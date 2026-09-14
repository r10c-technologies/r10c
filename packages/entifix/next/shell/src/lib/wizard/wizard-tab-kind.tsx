'use client';

import { parseScreenPayload } from '@r10c/business-ts-authz';
import type { ReactNode } from 'react';

import type { TabKind } from '../workspace/tab-kind';

/** One wizard a workspace may open, as the registry needs it. */
export interface WizardTabScreen {
  /** The tab caption's catalog key — the wizard's name, never the step's. */
  readonly titleKey: string;
  /** `step` is the third address segment, absent while the flow is at its first. */
  render(step: string | undefined): ReactNode;
}

/**
 * The `wizard:` tab kind: `wizard:<key>` opens a flow, `wizard:<key>:<step>`
 * opens it at a step.
 *
 * The third segment is a **step** here and a record under `master:`, which is
 * the one thing [ADR 0045](../../../../../../../docs/adr/0045-the-wizard-a-step-graph-and-a-submit-that-hands-off.md)
 * changed about the address grammar — `screenAddress` and `parseScreenPayload`
 * already produced and accepted the shape.
 *
 * **The caption is the wizard's name and not the step's**, deliberately: a tab
 * whose title changed on every Siguiente would reflow the strip mid-flow and
 * make an open wizard hard to find again by the name it was opened under.
 *
 * A factory rather than a constant, for the reason `masterKind` is built in the
 * host: which screens a workspace offers is the host's decision, and the shells
 * that own the wizards may not import each other.
 */
export function wizardTabKind(
  screens: Record<string, WizardTabScreen>,
): TabKind<{ key: string; id?: string }> {
  return {
    kind: 'wizard',
    match: payload => {
      const parsed = parseScreenPayload(payload);
      if (parsed === null) return null;
      return parsed.key in screens ? parsed : null;
    },
    toParam: addr =>
      addr.id === undefined ? addr.key : `${addr.key}:${addr.id}`,
    title: (addr, translate) => translate(screens[addr.key].titleKey),
    render: addr => screens[addr.key].render(addr.id),
  };
}
