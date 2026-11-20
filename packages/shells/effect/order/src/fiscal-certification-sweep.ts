import { ShutdownRegistryTag } from '@entifix/business';
import {
  certifyFiscalDocuments,
  FiscalCertifierTag,
  ProductOrderStoreTag,
} from '@r10c/business-ts-order-management';
import { logSliceOutcome } from '@r10c/shells-effect-service';
import { Duration, Effect, Fiber, Schedule } from 'effect';

/**
 * One pass of the fiscal sweep (ADR 0078 §6, #668): certify every order paid
 * for and not yet certified, and void the document of every order cancelled
 * after it. A refusal is logged here, because this is the fork site
 * (ADR 0064), and recorded on the order; it never moves the order, so the
 * payment stands. Never fails — the daemon must not end, and a failed pass
 * leaves its orders to the next one.
 */
export const sweepFiscalDocuments = (retryBackoffMs: number) =>
  Effect.gen(function* () {
    const pass = yield* certifyFiscalDocuments(new Date(), retryBackoffMs);
    if (pass.failed > 0) {
      yield* logSliceOutcome('Warn', 'fiscal certifier refused', {
        failed: pass.failed,
      });
    }
    if (pass.certified > 0 || pass.voided > 0) {
      yield* logSliceOutcome('Debug', 'fiscal documents recorded', {
        certified: pass.certified,
        voided: pass.voided,
      });
    }
  }).pipe(
    Effect.catch(failure =>
      logSliceOutcome('Error', 'fiscal sweep failed', {}, failure),
    ),
  );

/** Fork the sweep on `intervalMs`, once at boot and then on the interval. */
export const startFiscalCertificationSweep = (
  intervalMs: number,
  retryBackoffMs: number,
) =>
  Effect.gen(function* () {
    const orders = yield* ProductOrderStoreTag;
    const certifier = yield* FiscalCertifierTag;
    const shutdown = yield* ShutdownRegistryTag;

    const sweepOnce = sweepFiscalDocuments(retryBackoffMs).pipe(
      Effect.provideService(ProductOrderStoreTag, orders),
      Effect.provideService(FiscalCertifierTag, certifier),
    );

    const daemon = yield* Effect.forkDetach(
      sweepOnce.pipe(
        Effect.repeat(Schedule.spaced(Duration.millis(intervalMs))),
      ),
    );

    yield* shutdown.register({
      name: 'fiscal-certification-sweep',
      phase: 'flush',
      run: Fiber.interrupt(daemon),
    });
  });
