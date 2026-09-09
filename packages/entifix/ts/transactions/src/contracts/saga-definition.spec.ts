import { EntifixLogicError } from '@r10c/entifix-ts-core';
import { describe, expect, it } from 'vitest';

import {
  defineSaga,
  type SagaCall,
  sagaCommandId,
  type SagaStep,
} from './saga-definition.js';

const post: SagaCall = { method: 'POST', path: '/api/reservation' };
const del: SagaCall = {
  method: 'DELETE',
  path: '/api/reservation/{outcome.data.id}',
};

const step = (
  overrides: Partial<SagaStep> & Pick<SagaStep, 'id'>,
): SagaStep => ({
  participant: 'stock-service',
  command: post,
  kind: 'compensatable',
  compensation: del,
  ...overrides,
});

describe('defineSaga validates at load', () => {
  it('returns a well-formed definition unchanged', () => {
    const definition = {
      name: 'checkout',
      steps: [
        step({ id: 'reserve', fanOut: true }),
        step({ id: 'write-order' }),
      ],
    };

    expect(defineSaga(definition)).toBe(definition);
  });

  /**
   * ⚠️ The case ADR 0052 had to settle, and the reason this test carries the
   * reasoning rather than just the assertion: checkout is entirely pre-pivot
   * until payment lands in M4. A validator demanding exactly one pivot would
   * push the order write into a role it would have to be removed from later.
   */
  it('accepts a definition with no pivot at all', () => {
    expect(() =>
      defineSaga({ name: 'checkout', steps: [step({ id: 'reserve' })] }),
    ).not.toThrow();
  });

  it('accepts the full compensatable → pivot → retriable shape', () => {
    expect(() =>
      defineSaga({
        name: 'full',
        steps: [
          step({ id: 'reserve' }),
          step({ id: 'capture', kind: 'pivot', compensation: undefined }),
          step({ id: 'notify', kind: 'retriable', compensation: undefined }),
        ],
      }),
    ).not.toThrow();
  });

  it('refuses a definition with no steps', () => {
    expect(() => defineSaga({ name: 'empty', steps: [] })).toThrow(
      EntifixLogicError,
    );
    expect(() => defineSaga({ name: 'empty', steps: [] })).toThrow(
      /declares no steps/,
    );
  });

  /**
   * The command id is `<sagaId>:<stepId>`, so two steps sharing an id share one
   * idempotency key — the second would be dropped as a redelivery of the first
   * and never run at all.
   */
  it('refuses two steps sharing an id', () => {
    expect(() =>
      defineSaga({
        name: 'dup',
        steps: [step({ id: 'reserve' }), step({ id: 'reserve' })],
      }),
    ).toThrow(/two steps share the id 'reserve'/);
  });

  it('refuses more than one pivot', () => {
    expect(() =>
      defineSaga({
        name: 'two-pivots',
        steps: [
          step({ id: 'a', kind: 'pivot', compensation: undefined }),
          step({ id: 'b', kind: 'pivot', compensation: undefined }),
        ],
      }),
    ).toThrow(/declares 2 pivots \(a, b\)/);
  });

  it('refuses a compensatable step after the pivot', () => {
    expect(() =>
      defineSaga({
        name: 'late',
        steps: [
          step({ id: 'capture', kind: 'pivot', compensation: undefined }),
          step({ id: 'reserve' }),
        ],
      }),
    ).toThrow(/'reserve' is compensatable but sits after the pivot 'capture'/);
  });

  it('refuses a compensatable step with no compensation', () => {
    expect(() =>
      defineSaga({
        name: 'no-undo',
        steps: [step({ id: 'reserve', compensation: undefined })],
      }),
    ).toThrow(/'reserve' is compensatable but declares no compensation/);
  });

  /**
   * Not dead code but a false assurance: such a compensation could never run,
   * so writing one says the step is reversible when it is not.
   */
  it('refuses a pivot that declares a compensation', () => {
    expect(() =>
      defineSaga({
        name: 'undoable-pivot',
        steps: [step({ id: 'capture', kind: 'pivot' })],
      }),
    ).toThrow(/'capture' is pivot and declares a compensation/);
  });

  it('refuses a retriable step that declares a compensation', () => {
    expect(() =>
      defineSaga({
        name: 'undoable-retry',
        steps: [
          step({ id: 'capture', kind: 'pivot', compensation: undefined }),
          step({ id: 'notify', kind: 'retriable' }),
        ],
      }),
    ).toThrow(/'notify' is retriable and declares a compensation/);
  });

  it('refuses a retriable step before the pivot', () => {
    expect(() =>
      defineSaga({
        name: 'early-retry',
        steps: [
          step({ id: 'notify', kind: 'retriable', compensation: undefined }),
          step({ id: 'capture', kind: 'pivot', compensation: undefined }),
        ],
      }),
    ).toThrow(/'notify' is retriable but sits before the pivot/);
  });

  it('refuses a retriable step when there is no pivot at all', () => {
    expect(() =>
      defineSaga({
        name: 'no-pivot-retry',
        steps: [
          step({ id: 'notify', kind: 'retriable', compensation: undefined }),
        ],
      }),
    ).toThrow(/'notify' is retriable but sits before the pivot/);
  });

  it('names the definition in the thrown error details', () => {
    try {
      defineSaga({ name: 'checkout', steps: [] });
      expect.unreachable('defineSaga should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(EntifixLogicError);
      expect((error as EntifixLogicError).details).toEqual({
        definition: 'checkout',
      });
    }
  });
});

describe('sagaCommandId', () => {
  it('is <sagaId>:<stepId> for a single-call step', () => {
    expect(sagaCommandId('saga-1', 'reserve')).toBe('saga-1:reserve');
  });

  /**
   * A fan-out step's calls are separate side effects, so each is claimed on its
   * own — one key for the whole step would let a redelivery of line 2 be read
   * as a duplicate of line 1.
   */
  it('appends the element index on a fan-out call', () => {
    expect(sagaCommandId('saga-1', 'reserve', 0)).toBe('saga-1:reserve:0');
    expect(sagaCommandId('saga-1', 'reserve', 2)).toBe('saga-1:reserve:2');
  });
});
