import { describe, expect, it } from 'vitest';

import { EntifixLogicError } from '../base-entities/entifix-error/index.js';
import type { WizardDefinition } from './wizard-definition.js';
import {
  advanceWizard,
  canFinish,
  goBackWizard,
  goToWizardStep,
  nextStepId,
  stepStatuses,
  wizardPath,
  WizardStepStatuses,
} from './wizard-navigation.js';
import { emptyWizardState, type WizardState } from './wizard-state.js';

/** `start` branches on its own answer; both branches converge on `identity`. */
const productSetup: WizardDefinition = {
  key: 'product-setup',
  steps: [
    {
      id: 'start',
      kind: 'choice',
      labelKey: 'start',
      options: ['blank', 'duplicate'],
      to: ['identity', 'source'],
      next: state =>
        (state.steps.start as { option?: string } | undefined)?.option ===
        'duplicate'
          ? 'source'
          : 'identity',
    },
    { id: 'source', kind: 'selection', labelKey: 'source', to: ['identity'] },
    { id: 'identity', kind: 'form', labelKey: 'identity', to: ['summary'] },
    { id: 'summary', kind: 'summary', labelKey: 'summary', to: [] },
  ],
};

const at = (
  activeStep: string,
  history: readonly string[] = [],
  steps: WizardState['steps'] = {},
): WizardState => ({ activeStep, history, steps });

const chose = (option: string): WizardState['steps'] => ({
  start: { kind: 'choice', option },
});

describe('the step statuses', () => {
  it('are the four a stepper can show', () => {
    expect([...WizardStepStatuses]).toEqual([
      'pending',
      'active',
      'complete',
      'error',
    ]);
  });
});

describe('nextStepId', () => {
  it('takes the only edge when a step declares one', () => {
    expect(nextStepId(productSetup, at('identity'))).toBe('summary');
  });

  it('asks next() when a step declares several', () => {
    expect(nextStepId(productSetup, at('start', [], chose('duplicate')))).toBe(
      'source',
    );
    expect(nextStepId(productSetup, at('start', [], chose('blank')))).toBe(
      'identity',
    );
  });

  it('falls back to the first edge while a branch point is unanswered', () => {
    expect(nextStepId(productSetup, at('start'))).toBe('identity');
  });

  it('has nowhere to go from the step that ends the flow', () => {
    expect(nextStepId(productSetup, at('summary'))).toBeUndefined();
  });

  it('has nowhere to go from a step the definition does not declare', () => {
    expect(nextStepId(productSetup, at('ghost'))).toBeUndefined();
  });

  it('throws when next() returns a step the edges never declared', () => {
    const stray: WizardDefinition = {
      key: 'stray',
      steps: [
        {
          id: 'a',
          kind: 'form',
          labelKey: 'a',
          to: ['end'],
          next: () => 'somewhere-else',
        },
        { id: 'end', kind: 'summary', labelKey: 'end', to: [] },
      ],
    };

    expect(() => nextStepId(stray, at('a'))).toThrow(EntifixLogicError);
    expect(() => nextStepId(stray, at('a'))).toThrow(
      /chose "somewhere-else", which is not one of its edges/,
    );
  });
});

describe('advanceWizard', () => {
  it('moves on and remembers where it came from', () => {
    const next = advanceWizard(productSetup, at('start', [], chose('blank')));

    expect(next.activeStep).toBe('identity');
    expect(next.history).toEqual(['start']);
  });

  it('leaves a terminal step where it is', () => {
    const state = at('summary', ['identity']);

    expect(advanceWizard(productSetup, state)).toBe(state);
  });
});

describe('goBackWizard', () => {
  it('pops the path actually taken', () => {
    const next = goBackWizard(at('identity', ['start', 'source']));

    expect(next.activeStep).toBe('source');
    expect(next.history).toEqual(['start']);
  });

  it('keeps the answers, so returning restores the work', () => {
    const state = at('identity', ['start'], chose('blank'));

    expect(goBackWizard(state).steps).toEqual(state.steps);
  });

  it('leaves the entry step where it is', () => {
    const state = emptyWizardState('start');

    expect(goBackWizard(state)).toBe(state);
  });
});

describe('goToWizardStep', () => {
  it('jumps back to a visited step and truncates the path to before it', () => {
    const next = goToWizardStep(
      at('summary', ['start', 'source', 'identity']),
      'source',
    );

    expect(next.activeStep).toBe('source');
    expect(next.history).toEqual(['start']);
  });

  it('refuses a step that is not on the path already walked', () => {
    // Forward would skip the per-step submit that validates what lies between,
    // which is the only thing gating advancement.
    const state = at('start', []);

    expect(goToWizardStep(state, 'summary')).toBe(state);
  });
});

describe('canFinish', () => {
  it('is true only on the step that ends the flow', () => {
    expect(canFinish(productSetup, at('summary'))).toBe(true);
    expect(canFinish(productSetup, at('identity'))).toBe(false);
  });
});

describe('wizardPath', () => {
  it('projects the whole flow from an unanswered entry step', () => {
    expect(wizardPath(productSetup, emptyWizardState('start'))).toEqual([
      'start',
      'identity',
      'summary',
    ]);
  });

  it('re-shapes as the branch point is answered', () => {
    expect(
      wizardPath(productSetup, at('start', [], chose('duplicate'))),
    ).toEqual(['start', 'source', 'identity', 'summary']);
  });

  it('keeps the steps already walked ahead of the ones still to come', () => {
    expect(
      wizardPath(productSetup, at('identity', ['start', 'source'])),
    ).toEqual(['start', 'source', 'identity', 'summary']);
  });

  it('stops rather than looping on a definition that cycles', () => {
    // `assertWizardDefinition` refuses this at load; the guard exists because a
    // render loop is a worse way to find out.
    const looping: WizardDefinition = {
      key: 'looping',
      steps: [
        { id: 'a', kind: 'form', labelKey: 'a', to: ['b'] },
        { id: 'b', kind: 'form', labelKey: 'b', to: ['a'] },
      ],
    };

    expect(wizardPath(looping, at('a'))).toEqual(['a', 'b']);
  });
});

describe('stepStatuses', () => {
  it('marks the walked steps complete, the current one active, the rest pending', () => {
    expect(
      stepStatuses(productSetup, at('identity', ['start', 'source'])),
    ).toEqual([
      { id: 'start', status: 'complete' },
      { id: 'source', status: 'complete' },
      { id: 'identity', status: 'active' },
      { id: 'summary', status: 'pending' },
    ]);
  });

  it('lets an error win over both complete and active', () => {
    // The step someone has been through and left invalid is exactly the one the
    // stepper has to point at.
    expect(
      stepStatuses(productSetup, at('identity', ['start']), [
        'start',
        'identity',
      ]),
    ).toEqual([
      { id: 'start', status: 'error' },
      { id: 'identity', status: 'error' },
      { id: 'summary', status: 'pending' },
    ]);
  });
});
