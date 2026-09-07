import {
  advanceWizard,
  assertWizardDefinition,
  canFinish,
  emptyWizardState,
  goBackWizard,
  goToWizardStep,
  stepStatuses,
  withStepValue,
  type WizardDefinition,
} from '@r10c/entifix-ts-core';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Button } from '../../atoms/button';
import { Text } from '../../atoms/text';
import { Cluster } from '../../layout/cluster';
import { Stack } from '../../molecules/stack';
import { Wizard } from './wizard';

/**
 * The shape the first real wizard takes: a branch point whose answer decides
 * whether a table step appears at all, two shared form steps, and a summary.
 */
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

assertWizardDefinition(productSetup);

const LABELS: Record<string, string> = {
  start: 'Origen',
  source: 'Producto base',
  identity: 'Datos',
  summary: 'Resumen',
};

const BODIES: Record<string, string> = {
  start: 'Elegí si partís de cero o duplicás un producto que ya existe.',
  source: 'Acá iría la tabla de productos, con selección de una fila.',
  identity: 'Acá irían código, nombre y descripción.',
  summary: 'Acá iría el repaso de todo lo respondido, sin poder editarlo.',
};

/**
 * A driven wizard: the state machine from `entifix-ts-core`, the control from
 * here, and nothing else. It is what a real host does minus the persistence and
 * the router, which is exactly the seam the control does not own.
 */
function Driven({ seedChoice }: { seedChoice?: string }) {
  const [state, setState] = useState(() => {
    const fresh = emptyWizardState('start');
    return seedChoice === undefined
      ? fresh
      : withStepValue(fresh, 'start', { kind: 'choice', option: seedChoice });
  });
  const statuses = stepStatuses(productSetup, state);

  return (
    <Wizard
      steps={statuses.map(({ id, status }) => ({
        id,
        label: LABELS[id],
        status,
      }))}
      activeStep={state.activeStep}
      title={LABELS[state.activeStep]}
      canFinish={canFinish(productSetup, state)}
      onNext={() => setState(current => advanceWizard(productSetup, current))}
      onPrevious={
        state.history.length > 0 ? () => setState(goBackWizard) : undefined
      }
      onStepChange={stepId =>
        setState(current => goToWizardStep(current, stepId))
      }
      onFinish={() => undefined}
    >
      <Stack gap="s">
        <Text tone="muted">{BODIES[state.activeStep]}</Text>
        {state.activeStep === 'start' && (
          <Cluster gap="2xs">
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                setState(current =>
                  withStepValue(current, 'start', {
                    kind: 'choice',
                    option: 'blank',
                  }),
                )
              }
            >
              {'Desde cero'}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                setState(current =>
                  withStepValue(current, 'start', {
                    kind: 'choice',
                    option: 'duplicate',
                  }),
                )
              }
            >
              {'Duplicar uno existente'}
            </Button>
          </Cluster>
        )}
      </Stack>
    </Wizard>
  );
}

const meta = {
  title: 'Organisms/Wizard',
  component: Wizard,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Wizard>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The whole flow, driven. Press Siguiente to walk it; a completed step in the
 * stepper is clickable and jumps back to it.
 */
export const Default: Story = { render: () => <Driven /> };

/**
 * The same wizard with the branch already taken, so the stepper shows **four**
 * steps rather than three: the path is projected from the answers, not read off
 * the declared step list. Press Atrás and pick the other option to watch the
 * extra step disappear again.
 */
export const Branching: Story = {
  render: () => <Driven seedChoice="duplicate" />,
};

/** What a resumed wizard shows before the operator carries on. */
export const WithRecap: Story = {
  args: {
    steps: [
      { id: 'start', label: 'Origen', status: 'complete' },
      { id: 'identity', label: 'Datos', status: 'active' },
      { id: 'summary', label: 'Resumen', status: 'pending' },
    ],
    activeStep: 'identity',
    title: 'Datos',
    onNext: () => undefined,
    onFinish: () => undefined,
    onPrevious: () => undefined,
    onDismissRecap: () => undefined,
    recap: (
      <Stack gap="3xs">
        <Text step={-1}>{'Origen: desde cero'}</Text>
        <Text step={-1}>{'Marca: Café del Valle'}</Text>
      </Stack>
    ),
    children: (
      <Text tone="muted">{'Acá irían código, nombre y descripción.'}</Text>
    ),
  },
};

/**
 * The submit in flight. It stays in flight: `onFinish` hands off and returns
 * before the write is terminal, so the button says "Enviando…" and never
 * "guardado".
 */
export const Submitting: Story = {
  args: {
    steps: [
      { id: 'start', label: 'Origen', status: 'complete' },
      { id: 'identity', label: 'Datos', status: 'complete' },
      { id: 'summary', label: 'Resumen', status: 'active' },
    ],
    activeStep: 'summary',
    title: 'Resumen',
    canFinish: true,
    isSubmitting: true,
    onNext: () => undefined,
    onFinish: () => undefined,
    onPrevious: () => undefined,
    children: <Text tone="muted">{'Repaso de todo lo respondido.'}</Text>,
  },
};

/** Required by the loading contract: a control with `isLoading` shows it. */
export const Loading: Story = {
  args: {
    steps: [
      { id: 'start', label: 'Origen', status: 'pending' },
      { id: 'identity', label: 'Datos', status: 'pending' },
      { id: 'summary', label: 'Resumen', status: 'pending' },
    ],
    activeStep: 'start',
    title: 'Origen',
    isLoading: true,
    onNext: () => undefined,
    onFinish: () => undefined,
    children: null,
  },
};
