import { FLOW_RECIPES, flowCatalog } from '@r10c/shells-effect-flow-catalog';
import { describe, expect, it } from 'vitest';

import { SAGAS } from './index.js';

/**
 * ⚠️ **Two statements of one flow, until the engine deletes one of them.** The
 * coordinator still runs `checkout.saga.ts` and `cancellation.saga.ts`, while
 * the flow catalog's recipes are what `$metadata` reports and what CI
 * enumerates (ADR 0065). The recipes promise to reproduce the sagas step for
 * step, and this is what keeps that promise from drifting until #486/#487
 * retire the sagas.
 *
 * A saga runs the card path, so where a recipe stage offers alternatives the
 * first one is compared, and `flow.commit@1` — a step with no participant —
 * has no saga counterpart.
 */
type Call = { readonly method: string; readonly path: string } | undefined;

/** One path grammar for both sides: `{input.orderId}` and `:id` are a parameter. */
const normalized = (call: Call) =>
  call === undefined
    ? undefined
    : `${call.method} ${call.path.replace(/\{[^}]+\}|:[A-Za-z]+/g, ':param')}`;

const recipeSteps = (name: keyof typeof FLOW_RECIPES) =>
  FLOW_RECIPES[name].stages.map(stage => {
    const ref = stage.steps[0]?.ref ?? '';
    const fragment = flowCatalog.get(ref);
    if (fragment === undefined) throw new Error(`no fragment ${ref}`);
    return {
      participant: fragment.participant,
      call: normalized(fragment.call),
      compensation: normalized(fragment.compensation),
      kind: fragment.kind,
    };
  });

const sagaSteps = (name: keyof typeof FLOW_RECIPES) =>
  (SAGAS[name]?.steps ?? []).map(step => ({
    participant: step.participant,
    call: normalized(step.command),
    compensation: normalized(step.compensation),
    kind: step.kind,
  }));

describe('The recipes reproduce the running sagas', () => {
  it.each(Object.keys(FLOW_RECIPES) as (keyof typeof FLOW_RECIPES)[])(
    '%s calls what its saga calls, in the same order',
    name => {
      expect(recipeSteps(name)).toEqual(sagaSteps(name));
    },
  );
});
