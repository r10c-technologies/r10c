import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Wizard } from './wizard';
import type { WizardProps, WizardStepView } from './wizard.types';

const steps: WizardStepView[] = [
  { id: 'start', label: 'Origen', status: 'complete' },
  { id: 'identity', label: 'Datos', status: 'active' },
  { id: 'summary', label: 'Resumen', status: 'pending' },
];

const renderWizard = (overrides: Partial<WizardProps> = {}) => {
  const onNext = vi.fn();
  const onFinish = vi.fn();
  const onPrevious = vi.fn();
  const onStepChange = vi.fn();

  const result = render(
    <Wizard
      steps={steps}
      activeStep="identity"
      title="Datos del producto"
      onNext={onNext}
      onFinish={onFinish}
      onPrevious={onPrevious}
      {...overrides}
    >
      <p>{'cuerpo del paso'}</p>
    </Wizard>,
  );

  return {
    ...result,
    onNext,
    onFinish,
    onPrevious,
    onStepChange,
    user: userEvent.setup(),
  };
};

describe('the stepper', () => {
  it('is an ordered list, not a tablist', () => {
    renderWizard();

    // A tablist would tell assistive technology the panels are siblings the
    // user may choose between; a wizard's steps are ordered and gated.
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Pasos' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('marks the active step with aria-current="step"', () => {
    renderWizard();

    const current = screen
      .getAllByRole('listitem')
      .filter(item => item.getAttribute('aria-current') === 'step');

    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent('Datos');
  });

  it('announces each step status, so colour is not the only carrier', () => {
    renderWizard();
    const items = screen.getAllByRole('listitem');

    expect(items[0]).toHaveTextContent('completado');
    expect(items[1]).toHaveTextContent('en curso');
    expect(items[2]).toHaveTextContent('pendiente');
  });

  it('announces an errored step', () => {
    renderWizard({
      steps: [
        { id: 'start', label: 'Origen', status: 'error' },
        { id: 'summary', label: 'Resumen', status: 'pending' },
      ],
    });

    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('con errores');
  });

  it('says which step of how many the operator is on', () => {
    renderWizard();

    expect(screen.getByText('Paso 2 de 3')).toBeInTheDocument();
  });

  it('says nothing about position when the active step is not on the path', () => {
    renderWizard({ activeStep: 'somewhere-else' });

    expect(screen.queryByText(/Paso/)).not.toBeInTheDocument();
  });
});

describe('jumping back through the stepper', () => {
  it('makes a completed step clickable and reports it', async () => {
    const onStepChange = vi.fn();
    const { user } = renderWizard({ onStepChange });

    await user.click(screen.getByRole('button', { name: 'Volver a Origen' }));

    expect(onStepChange).toHaveBeenCalledWith('start');
  });

  it('leaves a pending step as plain text rather than a disabled button', () => {
    // A disabled control is still announced as a control, so a pending step
    // would read as something the operator may activate and cannot.
    renderWizard({ onStepChange: vi.fn() });

    expect(
      screen.queryByRole('button', { name: /Volver a Resumen/ }),
    ).not.toBeInTheDocument();
  });

  it('is read-only when no handler is given', () => {
    renderWizard();

    expect(
      screen.queryByRole('button', { name: /Volver a/ }),
    ).not.toBeInTheDocument();
  });
});

describe('the footer', () => {
  it('advances with Siguiente while the flow has somewhere to go', async () => {
    const { onNext, onFinish, user } = renderWizard();

    await user.click(screen.getByRole('button', { name: 'Continuar' }));

    expect(onNext).toHaveBeenCalledOnce();
    expect(onFinish).not.toHaveBeenCalled();
  });

  it('reads Finalizar on the step that ends the flow, and submits', async () => {
    const { onFinish, onNext, user } = renderWizard({ canFinish: true });

    await user.click(screen.getByRole('button', { name: 'Finalizar' }));

    expect(onFinish).toHaveBeenCalledOnce();
    expect(onNext).not.toHaveBeenCalled();
  });

  it('goes back when there is somewhere to go back to', async () => {
    const { onPrevious, user } = renderWizard();

    await user.click(screen.getByRole('button', { name: 'Atrás' }));

    expect(onPrevious).toHaveBeenCalledOnce();
  });

  it('offers no Atrás at the entry step', () => {
    renderWizard({ onPrevious: undefined });

    expect(
      screen.queryByRole('button', { name: 'Atrás' }),
    ).not.toBeInTheDocument();
  });

  it('blocks advancing while the step has an unanswered requirement', () => {
    renderWizard({ canAdvance: false });

    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();
  });

  it('says it is submitting and refuses a second one', () => {
    // "Enviando…", never "guardado": `onFinish` returns before the write is
    // terminal, so the control cannot claim the second thing.
    renderWizard({ canFinish: true, isSubmitting: true });

    expect(screen.getByRole('button', { name: 'Enviando…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Atrás' })).toBeDisabled();
  });
});

describe('the resume recap', () => {
  it('is absent until the caller supplies one', () => {
    renderWizard();

    expect(screen.queryByTestId('wizard-recap')).not.toBeInTheDocument();
  });

  it('shows what was already decided', () => {
    renderWizard({ recap: <p>{'Marca: Café del Valle'}</p> });

    const recap = screen.getByTestId('wizard-recap');
    expect(recap).toHaveTextContent('Retomando donde lo dejaste');
    expect(recap).toHaveTextContent('Marca: Café del Valle');
  });

  it('can be dismissed when the caller offers it', async () => {
    const onDismissRecap = vi.fn();
    const user = userEvent.setup();
    render(
      <Wizard
        steps={steps}
        activeStep="identity"
        title="t"
        onNext={vi.fn()}
        onFinish={vi.fn()}
        recap={<p>{'algo'}</p>}
        onDismissRecap={onDismissRecap}
      >
        {null}
      </Wizard>,
    );

    await user.click(screen.getByRole('button', { name: 'Entendido' }));

    expect(onDismissRecap).toHaveBeenCalledOnce();
  });

  it('has no dismiss control when the caller offers none', () => {
    renderWizard({ recap: <p>{'algo'}</p> });

    expect(
      screen.queryByRole('button', { name: 'Entendido' }),
    ).not.toBeInTheDocument();
  });
});

describe('the loading state', () => {
  it('holds the shape with a placeholder sized from the step count', () => {
    renderWizard({ isLoading: true });

    const holder = screen.getByTestId('wizard-skeleton');
    expect(holder).toHaveAttribute('aria-busy', 'true');
    expect(within(holder).getAllByTestId('skeleton')).toHaveLength(4);
  });

  it('falls back to a default step count when it has no steps yet', () => {
    renderWizard({ isLoading: true, steps: [] });

    const holder = screen.getByTestId('wizard-skeleton');
    expect(within(holder).getAllByTestId('skeleton')).toHaveLength(5);
  });

  it('renders a supplied placeholder instead of the default body', () => {
    renderWizard({ isLoading: true, skeleton: <p>{'cargando'}</p> });

    expect(screen.getByText('cargando')).toBeInTheDocument();
  });

  it('renders the wizard itself when the caller opts out of a placeholder', () => {
    renderWizard({ isLoading: true, skeleton: false });

    expect(screen.queryByTestId('wizard-skeleton')).not.toBeInTheDocument();
    expect(screen.getByText('cuerpo del paso')).toBeInTheDocument();
  });
});

describe('focus', () => {
  it('does not steal focus on mount', () => {
    renderWizard();

    // Taking it here would pull focus off whatever opened the wizard, which on
    // a route is the link the operator just used.
    expect(document.activeElement).toBe(document.body);
  });

  it('moves to the step heading on advance, so a keyboard lands somewhere', () => {
    const { rerender } = renderWizard();

    rerender(
      <Wizard
        steps={steps}
        activeStep="summary"
        title="Resumen"
        onNext={vi.fn()}
        onFinish={vi.fn()}
      >
        {null}
      </Wizard>,
    );

    expect(document.activeElement).toBe(
      screen.getByRole('heading', { name: 'Resumen' }),
    );
  });
});
