'use client';

import type { WizardStepStatus } from '@r10c/entifix-ts-core';
import { type ReactNode, useEffect, useRef } from 'react';

import { useT } from '../../../i18n';
import { Button } from '../../atoms/button';
import { Skeleton } from '../../atoms/skeleton';
import { Text } from '../../atoms/text';
import { Cluster } from '../../layout/cluster';
import { Card } from '../../molecules/card';
import { Stack } from '../../molecules/stack';
import { cn } from '../../utils/cn';
import type { WizardProps, WizardStepView } from './wizard.types';

/** How many placeholder steps stand in when the caller has none yet. */
const SKELETON_STEP_COUNT = 4;

/**
 * The status catalog keys, written out rather than composed.
 *
 * `t(\`wizard.status.${status}\`)` would work and would be untyped — the
 * augmentation cannot see a template literal, so the only thing left checking
 * it would be `@r10c/i18n-check`, which does not read `.tsx`. Four literals
 * cost nothing and stay compile-checked.
 */
const STATUS_KEY = {
  pending: 'wizard.status.pending',
  active: 'wizard.status.active',
  complete: 'wizard.status.complete',
  error: 'wizard.status.error',
} as const satisfies Record<WizardStepStatus, string>;

const MARKER_CLASS: Record<WizardStepStatus, string> = {
  pending: 'border-border bg-surface text-content-muted',
  active: 'border-accent bg-accent text-primary-content',
  complete: 'border-accent bg-surface text-accent',
  error: 'border-danger bg-danger-subtle text-danger',
};

const LABEL_CLASS: Record<WizardStepStatus, string> = {
  pending: 'text-content-muted',
  active: 'font-medium text-content',
  complete: 'text-content',
  error: 'font-medium text-danger',
};

/**
 * A guided multi-step flow: the stepper, the active step's body, and the
 * controls that move between them.
 *
 * **Presentational, and controlled from above.** It holds no step state, no
 * draft and no router — `activeStep` is a prop and `onStepChange` reports a
 * click, the same rule that made `hrefFor` a prop, so URL synchronisation stays
 * the shell's job and this control can be told to render step four by a route,
 * a workspace tab, or a Storybook arg without knowing which
 * ([ADR 0045](../../../../../../../docs/adr/0045-the-wizard-a-step-graph-and-a-submit-that-hands-off.md)).
 *
 * ⚠️ **The stepper is an ordered list, not a tablist.** `TabStrip` is the
 * nearest-looking thing in this package and is the wrong precedent: a
 * `role="tablist"` tells assistive technology that the panels are siblings the
 * user may choose between, and a wizard's steps are ordered and gated. So this
 * is `<ol>`/`<li>` with `aria-current="step"`, and each step's status is
 * announced rather than carried by colour alone.
 */
export function Wizard({
  steps,
  activeStep,
  title,
  children,
  onNext,
  onFinish,
  onPrevious,
  onStepChange,
  canFinish = false,
  canAdvance = true,
  isSubmitting = false,
  recap,
  onDismissRecap,
  isLoading = false,
  skeleton = true,
  className,
}: WizardProps) {
  const t = useT();
  const heading = useRef<HTMLHeadingElement>(null);
  const focused = useRef(activeStep);

  // Focus moves to the new step's heading, and **only on a change**: doing it on
  // mount would take focus from whatever opened the wizard, which on a route is
  // the link the operator just used.
  useEffect(() => {
    if (focused.current === activeStep) return;
    focused.current = activeStep;
    heading.current?.focus();
  }, [activeStep]);

  if (isLoading && skeleton !== false) {
    return (
      <WizardSkeleton
        stepCount={steps.length > 0 ? steps.length : SKELETON_STEP_COUNT}
        placeholder={skeleton === true ? undefined : skeleton}
        className={className}
      />
    );
  }

  const position = steps.findIndex(step => step.id === activeStep) + 1;

  return (
    <Stack gap="m" className={className}>
      <Stepper
        steps={steps}
        activeStep={activeStep}
        onStepChange={onStepChange}
      />

      {recap && (
        <Card data-testid="wizard-recap" className="border-l-4 border-l-accent">
          <Stack gap="2xs">
            <Text as="h3" step={0} weight="semibold">
              {t('wizard.resume.title')}
            </Text>
            {recap}
            {onDismissRecap && (
              <Cluster justify="end">
                <Button variant="ghost" size="sm" onClick={onDismissRecap}>
                  {t('wizard.resume.dismiss')}
                </Button>
              </Cluster>
            )}
          </Stack>
        </Card>
      )}

      {/* No `Card` around the body: a step brings its own surface — an embedded
          `EntityForm` is already a card — and nesting one inside another reads
          as two panels for one step. */}
      <Stack gap="s">
        <Stack gap="3xs">
            {/*
              A plain heading with a real ref, and `tabIndex={-1}` so script can
              focus it without putting it in the tab order — the target of the
              advance above.
            */}
            <h2
              ref={heading}
              tabIndex={-1}
              className="rounded-sm text-step-1 font-semibold text-content focus-ring outline-none"
            >
              {title}
            </h2>
          {position > 0 && (
            <Text step={-1} tone="muted">
              {t('wizard.stepOf', {
                current: position,
                total: steps.length,
              })}
            </Text>
          )}
        </Stack>

        {children}
      </Stack>

      <Cluster justify="between">
        <div>
          {onPrevious && (
            <Button
              type="button"
              variant="secondary"
              data-testid="wizard-previous"
              onClick={onPrevious}
              disabled={isSubmitting}
            >
              {t('wizard.previous')}
            </Button>
          )}
        </div>
        {/* Named for the tests and the e2e, because a step may bring controls
            of its own — a table step's pager sits in the same view. */}
        <Button
          type="button"
          data-testid="wizard-next"
          onClick={canFinish ? onFinish : onNext}
          disabled={isSubmitting || !canAdvance}
        >
          {isSubmitting && t('wizard.submitting')}
          {!isSubmitting && canFinish && t('wizard.finish')}
          {!isSubmitting && !canFinish && t('wizard.next')}
        </Button>
      </Cluster>
    </Stack>
  );
}

interface StepperProps {
  steps: readonly WizardStepView[];
  activeStep: string;
  onStepChange?: (stepId: string) => void;
}

function Stepper({ steps, activeStep, onStepChange }: StepperProps) {
  const t = useT();

  return (
    <ol
      aria-label={t('wizard.steps')}
      className="flex flex-wrap items-center gap-x-s gap-y-2xs"
    >
      {steps.map((step, index) => (
        <li
          key={step.id}
          aria-current={step.id === activeStep ? 'step' : undefined}
          className="flex items-center gap-2xs"
        >
          <StepMarker step={step} index={index} onStepChange={onStepChange} />
          {index < steps.length - 1 && (
            <span aria-hidden="true" className="h-px w-s shrink-0 bg-border" />
          )}
        </li>
      ))}
    </ol>
  );
}

interface StepMarkerProps {
  step: WizardStepView;
  index: number;
  onStepChange?: (stepId: string) => void;
}

/**
 * One step's dot and label.
 *
 * A completed step is a `<button>` and every other step is not, rather than a
 * disabled button throughout: a disabled control is still announced as a
 * control, so a pending step would read as something the operator may activate
 * and cannot, when in truth there is nothing there to activate yet.
 */
function StepMarker({ step, index, onStepChange }: StepMarkerProps) {
  const t = useT();
  const clickable = onStepChange !== undefined && step.status === 'complete';

  const body = (
    <>
      <span
        aria-hidden="true"
        className={cn(
          'flex size-6 shrink-0 items-center justify-center rounded-full border',
          'text-step-xs font-medium transition duration-200 ease-smooth',
          MARKER_CLASS[step.status],
        )}
      >
        {index + 1}
      </span>
      <span className={cn('text-step-sm', LABEL_CLASS[step.status])}>
        {step.label}
      </span>
      {/*
        Status is announced as well as coloured. A screen reader walks this list
        without seeing the ring, and "completed" is the whole point of a stepper.
      */}
      <span className="sr-only">{t(STATUS_KEY[step.status])}</span>
    </>
  );

  if (!clickable) {
    return <span className="flex items-center gap-3xs">{body}</span>;
  }

  return (
    <button
      type="button"
      onClick={() => onStepChange(step.id)}
      aria-label={t('wizard.goToStep', { label: step.label })}
      className="flex items-center gap-3xs rounded-md p-3xs focus-ring hover:bg-surface-elevated"
    >
      {body}
    </button>
  );
}

interface WizardSkeletonProps {
  stepCount: number;
  placeholder?: ReactNode;
  className?: string;
}

/**
 * The wizard's shape while it is in flight.
 *
 * Sized from the step count it was handed, so the swap to the real stepper
 * shifts nothing — the geometry rule every skeleton in this package follows.
 */
function WizardSkeleton({
  stepCount,
  placeholder,
  className,
}: WizardSkeletonProps) {
  return (
    <Stack
      gap="m"
      className={className}
      role="status"
      aria-busy="true"
      data-testid="wizard-skeleton"
    >
      <Cluster gap="s">
        {Array.from({ length: stepCount }, (_, index) => (
          <Skeleton key={index} shape="line" className="h-6 w-24" />
        ))}
      </Cluster>
      {placeholder ?? <Skeleton className="h-40 w-full" />}
    </Stack>
  );
}
