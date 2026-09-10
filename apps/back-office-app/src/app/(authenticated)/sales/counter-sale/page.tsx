'use client';

import { CounterSaleWizard } from '@r10c/shells-next-sales';
import { useSearchParams } from 'next/navigation';

/**
 * The till, as a plain route.
 *
 * Dual-host like every other screen here: the workspace opens the same flow as a
 * `wizard:counter-sale` tab. The step rides in the query string on this side,
 * which is what `useWizardStepUrl` writes and what an address pasted into a new
 * window restores.
 */
function CounterSalePage() {
  const step = useSearchParams().get('step') ?? undefined;

  return <CounterSaleWizard step={step} />;
}

export default CounterSalePage;
