import { describe, expect, it } from 'vitest';

import { EntifixBuildError } from '../base-entities/entifix-error/index.js';
import {
  assertWizardDefinition,
  entryStep,
  findStep,
  type WizardDefinition,
  type WizardStep,
  WizardStepKinds,
} from './wizard-definition.js';

/**
 * The shape the first real wizard takes: a branch point, a table step only one
 * branch reaches, two form steps both branches share, and a summary.
 */
const validDefinition = (): WizardDefinition => ({
  key: 'product-setup',
  steps: [
    {
      id: 'start',
      kind: 'choice',
      labelKey: 'start',
      options: ['blank', 'duplicate'],
      to: ['identity', 'source'],
      next: () => 'identity',
    },
    { id: 'source', kind: 'selection', labelKey: 'source', to: ['identity'] },
    { id: 'identity', kind: 'form', labelKey: 'identity', to: ['summary'] },
    { id: 'summary', kind: 'summary', labelKey: 'summary', to: [] },
  ],
});

const withSteps = (steps: readonly WizardStep[]): WizardDefinition => ({
  key: 'w',
  steps,
});

describe('the step kinds', () => {
  it('are the five a wizard can hold', () => {
    expect([...WizardStepKinds]).toEqual([
      'form',
      'selection',
      'choice',
      'summary',
      'custom',
    ]);
  });
});

describe('entryStep', () => {
  it('is the first declared step', () => {
    expect(entryStep(validDefinition()).id).toBe('start');
  });

  it('throws on a definition with no steps at all', () => {
    expect(() => entryStep(withSteps([]))).toThrow(EntifixBuildError);
  });
});

describe('findStep', () => {
  it('resolves a declared id', () => {
    expect(findStep(validDefinition(), 'identity')?.kind).toBe('form');
  });

  it('answers undefined for one the definition does not declare', () => {
    expect(findStep(validDefinition(), 'nope')).toBeUndefined();
  });
});

describe('assertWizardDefinition', () => {
  it('accepts a definition that branches, converges and ends in its summary', () => {
    expect(() => assertWizardDefinition(validDefinition())).not.toThrow();
  });

  it('refuses a definition with no steps', () => {
    expect(() => assertWizardDefinition(withSteps([]))).toThrow(
      /declares no steps/,
    );
  });

  it('refuses a duplicate step id, which would overwrite one step with another', () => {
    const definition = withSteps([
      { id: 'a', kind: 'form', labelKey: 'a', to: ['end'] },
      { id: 'a', kind: 'form', labelKey: 'a', to: ['end'] },
      { id: 'end', kind: 'summary', labelKey: 'end', to: [] },
    ]);

    expect(() => assertWizardDefinition(definition)).toThrow(
      /declares step "a" twice/,
    );
  });

  it('refuses an edge naming a step that does not exist', () => {
    const definition = withSteps([
      { id: 'a', kind: 'form', labelKey: 'a', to: ['typo'] },
      { id: 'end', kind: 'summary', labelKey: 'end', to: [] },
    ]);

    expect(() => assertWizardDefinition(definition)).toThrow(
      /leads to unknown step "typo"/,
    );
  });

  it('refuses several edges with no next() to choose between them', () => {
    const definition = withSteps([
      { id: 'a', kind: 'form', labelKey: 'a', to: ['b', 'end'] },
      { id: 'b', kind: 'form', labelKey: 'b', to: ['end'] },
      { id: 'end', kind: 'summary', labelKey: 'end', to: [] },
    ]);

    expect(() => assertWizardDefinition(definition)).toThrow(
      /has 2 edges and no next\(\)/,
    );
  });

  it('refuses a choice step offering nothing to choose', () => {
    const definition = withSteps([
      { id: 'a', kind: 'choice', labelKey: 'a', to: ['end'] },
      { id: 'end', kind: 'summary', labelKey: 'end', to: [] },
    ]);

    expect(() => assertWizardDefinition(definition)).toThrow(
      /choice step "a" offers no options/,
    );
  });

  it('refuses a choice step whose option list is empty', () => {
    const definition = withSteps([
      { id: 'a', kind: 'choice', labelKey: 'a', options: [], to: ['end'] },
      { id: 'end', kind: 'summary', labelKey: 'end', to: [] },
    ]);

    expect(() => assertWizardDefinition(definition)).toThrow(
      /offers no options/,
    );
  });

  it('refuses options on a step that is not a choice', () => {
    const definition = withSteps([
      { id: 'a', kind: 'form', labelKey: 'a', options: ['x'], to: ['end'] },
      { id: 'end', kind: 'summary', labelKey: 'end', to: [] },
    ]);

    expect(() => assertWizardDefinition(definition)).toThrow(
      /is a form step and cannot declare options/,
    );
  });

  it('refuses a wizard with no summary', () => {
    const definition = withSteps([
      { id: 'a', kind: 'form', labelKey: 'a', to: [] },
    ]);

    expect(() => assertWizardDefinition(definition)).toThrow(
      /declares 0 summary steps/,
    );
  });

  it('refuses a wizard with two summaries', () => {
    const definition = withSteps([
      { id: 'a', kind: 'summary', labelKey: 'a', to: ['b'] },
      { id: 'b', kind: 'summary', labelKey: 'b', to: [] },
    ]);

    expect(() => assertWizardDefinition(definition)).toThrow(
      /declares 2 summary steps/,
    );
  });

  it('refuses a flow that ends on something other than its summary', () => {
    const definition = withSteps([
      { id: 'a', kind: 'form', labelKey: 'a', to: ['dead'] },
      { id: 'dead', kind: 'form', labelKey: 'dead', to: [] },
      { id: 'end', kind: 'summary', labelKey: 'end', to: [] },
    ]);

    expect(() => assertWizardDefinition(definition)).toThrow(
      /ends on "dead", which is not its summary/,
    );
  });

  it('refuses a summary that leads onward', () => {
    const definition = withSteps([
      { id: 'a', kind: 'summary', labelKey: 'a', to: ['b'] },
      { id: 'b', kind: 'form', labelKey: 'b', to: [] },
    ]);

    expect(() => assertWizardDefinition(definition)).toThrow(
      /leads onward, and must end the flow/,
    );
  });

  it('refuses a step nothing reaches', () => {
    const definition = withSteps([
      { id: 'a', kind: 'form', labelKey: 'a', to: ['end'] },
      { id: 'orphan', kind: 'form', labelKey: 'orphan', to: ['end'] },
      { id: 'end', kind: 'summary', labelKey: 'end', to: [] },
    ]);

    expect(() => assertWizardDefinition(definition)).toThrow(
      /cannot reach "orphan" from "a"/,
    );
  });

  it('names every stranded step, not just the first', () => {
    const definition = withSteps([
      { id: 'a', kind: 'form', labelKey: 'a', to: ['end'] },
      { id: 'x', kind: 'form', labelKey: 'x', to: ['y'] },
      { id: 'y', kind: 'form', labelKey: 'y', to: ['end'] },
      { id: 'end', kind: 'summary', labelKey: 'end', to: [] },
    ]);

    expect(() => assertWizardDefinition(definition)).toThrow(
      /cannot reach "x", "y"/,
    );
  });

  it('reaches a step only the far branch leads to', () => {
    // `source` is reachable from `start`'s second edge alone, which is the case
    // a walk that only followed `next()` would call unreachable.
    expect(() => assertWizardDefinition(validDefinition())).not.toThrow();
    expect(findStep(validDefinition(), 'source')).toBeDefined();
  });
});
