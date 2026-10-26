import { describe } from 'vitest';

import { makeInMemoryPaymentLedger } from './in-memory-payment-ledger.js';
import { describePaymentLedgerContract } from './payment-ledger.contract.js';
import { describePaymentProviderContract } from './payment-provider.contract.js';
import { makeScriptedPaymentProvider } from './scripted-payment-provider.js';

describePaymentLedgerContract('the in-memory ledger', makeInMemoryPaymentLedger);

describe('the scripted provider', () => {
  describePaymentProviderContract('accepting everything', () =>
    makeScriptedPaymentProvider(),
  );
  describePaymentProviderContract('declining everything', () =>
    makeScriptedPaymentProvider(() => true),
  );
});
