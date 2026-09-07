import { describe, expect, it } from 'vitest';

import { ROW_KEY } from '../types/EntityRowDraft.js';
import {
  emptyWizardState,
  readStepChoice,
  readStepDraft,
  readStepIds,
  readStepValue,
  readWizardState,
  withStepValue,
  type WizardState,
} from './wizard-state.js';

const answered: WizardState = {
  activeStep: 'identity',
  history: ['start'],
  steps: {
    start: { kind: 'choice', option: 'duplicate' },
    source: { kind: 'selection', ids: ['product-1'] },
    identity: { kind: 'form', values: { name: 'Café' } },
    intro: { kind: 'none' },
  },
};

describe('emptyWizardState', () => {
  it('opens at the entry step with nothing answered', () => {
    expect(emptyWizardState('start')).toEqual({
      activeStep: 'start',
      history: [],
      steps: {},
    });
  });
});

describe('reading one step', () => {
  it('returns the stored value', () => {
    expect(readStepValue(answered, 'start')).toEqual({
      kind: 'choice',
      option: 'duplicate',
    });
  });

  it('returns undefined for a step nothing has answered', () => {
    expect(readStepValue(answered, 'summary')).toBeUndefined();
  });

  it('reads a form step as its draft', () => {
    expect(readStepDraft(answered, 'identity')).toEqual({ name: 'Café' });
  });

  it('reads an empty draft rather than undefined for a step of another kind', () => {
    // `{}` and not `undefined`, or the inputs seeded from it flip from
    // controlled to uncontrolled mid-render.
    expect(readStepDraft(answered, 'source')).toEqual({});
    expect(readStepDraft(answered, 'nothing-here')).toEqual({});
  });

  it('reads a selection step as its ids', () => {
    expect(readStepIds(answered, 'source')).toEqual(['product-1']);
  });

  it('reads no ids for a step of another kind', () => {
    expect(readStepIds(answered, 'identity')).toEqual([]);
    expect(readStepIds(answered, 'nothing-here')).toEqual([]);
  });

  it('reads a choice step as its option', () => {
    expect(readStepChoice(answered, 'start')).toBe('duplicate');
  });

  it('reads no option for a step of another kind or an unanswered one', () => {
    expect(readStepChoice(answered, 'identity')).toBeUndefined();
    expect(readStepChoice(answered, 'nothing-here')).toBeUndefined();
  });
});

describe('withStepValue', () => {
  it('replaces one step and leaves the rest alone', () => {
    const next = withStepValue(answered, 'start', {
      kind: 'choice',
      option: 'blank',
    });

    expect(readStepChoice(next, 'start')).toBe('blank');
    expect(next.steps.identity).toBe(answered.steps.identity);
    expect(answered.steps.start).toEqual({
      kind: 'choice',
      option: 'duplicate',
    });
  });
});

describe('readWizardState', () => {
  it('reads back a state it round-tripped through JSON', () => {
    const restored = readWizardState(JSON.parse(JSON.stringify(answered)));

    expect(restored).toEqual(answered);
  });

  it('reads a composition draft inside a form step', () => {
    const rows = [{ [ROW_KEY]: 'row-0', sku: 'A-1' }];
    const restored = readWizardState({
      activeStep: 'lines',
      history: [],
      steps: { lines: { kind: 'form', values: { items: rows } } },
    });

    expect(restored?.steps.lines).toEqual({
      kind: 'form',
      values: { items: rows },
    });
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['a string', 'start'],
    ['no activeStep', { history: [], steps: {} }],
    ['an empty activeStep', { activeStep: '', history: [], steps: {} }],
    ['a non-array history', { activeStep: 'a', history: 'a', steps: {} }],
    ['a history of non-strings', { activeStep: 'a', history: [1], steps: {} }],
    ['non-record steps', { activeStep: 'a', history: [], steps: [] }],
  ])('refuses %s', (_label, value) => {
    expect(readWizardState(value)).toBeUndefined();
  });

  it.each([
    ['an unknown kind', { kind: 'mystery' }],
    ['a step value that is not a record', 'blank'],
    ['a choice with no option', { kind: 'choice' }],
    ['a selection whose ids are not an array', { kind: 'selection', ids: 'a' }],
    [
      'a selection holding a non-string id',
      { kind: 'selection', ids: ['a', 2] },
    ],
    ['a form whose values are not a record', { kind: 'form', values: 'a' }],
    [
      'a form holding a member that is neither a string nor rows',
      { kind: 'form', values: { qty: 3 } },
    ],
    [
      'a form holding a row whose cells are not strings',
      { kind: 'form', values: { items: [{ qty: 3 }] } },
    ],
    [
      'a form holding a row that is not a record',
      { kind: 'form', values: { items: ['nope'] } },
    ],
  ])('refuses the whole state over %s', (_label, stepValue) => {
    // The whole state, not just the entry: dropping it would resume the operator
    // on a wizard that had silently forgotten one page of a flow it otherwise
    // restored perfectly.
    expect(
      readWizardState({
        activeStep: 'a',
        history: [],
        steps: { a: stepValue },
      }),
    ).toBeUndefined();
  });
});
