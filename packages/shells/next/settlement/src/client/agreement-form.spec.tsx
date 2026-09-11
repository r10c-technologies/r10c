import { Agreement } from '@r10c/business-ts-settlement-management';
import { EntifixQueryProvider } from '@r10c/entifix-react-integration';
import type {
  EntityMetadataDocument,
  EntityMetadataSource,
} from '@r10c/entifix-ts-core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { AgreementForm } from './agreement-form.js';

/**
 * The one hand-written form in the fleet's settlement surface, and the reason it
 * is hand-written: a map member has no editor, and the generated form would
 * write `NaN` over it on save.
 *
 * These drive the control rather than inspecting it. Every assertion here is
 * about a value surviving a round trip through the draft and the submit rebuild,
 * because that round trip is the thing the generator got wrong.
 */

const metadataSource = (
  actions: EntityMetadataDocument['actions'],
): EntityMetadataSource => ({
  fetchMetadata: async (): Promise<EntityMetadataDocument> => ({
    actions,
    useCases: [],
  }),
});

const existing = () => {
  const agreement = new Agreement('acme', 800);
  agreement.id = 'agreement-acme';
  agreement.channelCommissionBasisPoints = { counter: 0 };
  agreement.effectiveFrom = new Date('2026-01-01T00:00:00.000Z');
  return agreement;
};

// The form reads its affordances through a query, so it needs the provider the
// app mounts above every screen.
const renderForm = (form: ReactElement) =>
  render(<EntifixQueryProvider>{form}</EntifixQueryProvider>);

const rateInputs = () =>
  screen.getAllByRole('spinbutton') as HTMLInputElement[];

/** The channel inputs, in `SalesChannelTypes` order, after the default rate. */
const channelInputs = () => rateInputs().slice(1);

describe('the agreement form', () => {
  it('seeds the default rate and the per-channel overrides from the record', () => {
    renderForm(<AgreementForm entity={existing()} onSave={vi.fn()} />);

    expect(rateInputs()[0]?.value).toBe('800');
    expect(channelInputs().map(input => input.value)).toContain('0');
  });

  /**
   * ⚠️ **The round trip the generated form cannot make.** A map seeded through
   * the draft reads back as `"[object Object]"` and reconstructs as `NaN`; this
   * one has to come back as the object it went in as.
   */
  it('sends the rate map back unchanged when nothing is edited', async () => {
    const onSave = vi.fn();
    renderForm(<AgreementForm entity={existing()} onSave={onSave} />);

    fireEvent.click(screen.getByRole('button', { name: /guardar/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const saved = onSave.mock.calls[0]?.[0] as Agreement;
    expect(saved.channelCommissionBasisPoints).toEqual({ counter: 0 });
    expect(saved.commissionBasisPoints).toBe(800);
    expect(saved.id).toBe('agreement-acme');
  });

  it('keeps a typed zero distinct from a cleared field', async () => {
    const onSave = vi.fn();
    renderForm(<AgreementForm entity={existing()} onSave={onSave} />);

    const [first, second] = channelInputs();
    // Clear whichever channel carries the zero, and type a zero into another.
    fireEvent.change(first as HTMLInputElement, { target: { value: '' } });
    fireEvent.change(second as HTMLInputElement, { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const saved = onSave.mock.calls[0]?.[0] as Agreement;
    const rates = saved.channelCommissionBasisPoints ?? {};

    expect(Object.values(rates)).toEqual([0]);
    expect(Object.keys(rates)).toHaveLength(1);
  });

  /**
   * ⚠️ **Absent, not `{}`.** An agreement with no per-channel terms has none; a
   * stored empty object reads as "there are overrides here" to anyone inspecting
   * the record, and `commissionFor` treats the two identically anyway.
   */
  it('writes no rate map at all when every channel is cleared', async () => {
    const onSave = vi.fn();
    renderForm(<AgreementForm entity={existing()} onSave={onSave} />);

    for (const input of channelInputs()) {
      fireEvent.change(input, { target: { value: '' } });
    }
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const saved = onSave.mock.calls[0]?.[0] as Agreement;

    expect(saved.channelCommissionBasisPoints).toBeUndefined();
  });

  it('adds a rate to a record that had none', async () => {
    const onSave = vi.fn();
    const bare = new Agreement('acme', 500);
    bare.id = 'agreement-bare';

    renderForm(<AgreementForm entity={bare} onSave={onSave} />);

    fireEvent.change(channelInputs()[0] as HTMLInputElement, {
      target: { value: '250' },
    });
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const saved = onSave.mock.calls[0]?.[0] as Agreement;

    expect(Object.values(saved.channelCommissionBasisPoints ?? {})).toEqual([
      250,
    ]);
  });

  it('leaves the effective date absent when it is blank', async () => {
    const onSave = vi.fn();
    const bare = new Agreement('acme', 500);

    renderForm(<AgreementForm entity={bare} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(
      (onSave.mock.calls[0]?.[0] as Agreement).effectiveFrom,
    ).toBeUndefined();
  });

  /**
   * ⚠️ **Read-only is a fact the server states.** No role holds
   * `agreement:write`, so the served descriptor answers `["read"]` and the form
   * renders with no Save at all — with no flag passed from the page.
   */
  it('offers no Save when the descriptor withholds write', async () => {
    renderForm(
      <AgreementForm
        entity={existing()}
        onSave={vi.fn()}
        metadataSource={metadataSource(['read'])}
      />,
    );

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /guardar/i })).toBeNull(),
    );
    // And no rate inputs at all: read mode renders the summary instead, so
    // there is nothing that looks editable and refuses on submit.
    expect(screen.queryAllByRole('spinbutton')).toHaveLength(0);
  });

  it('offers Save when the descriptor allows write', async () => {
    renderForm(
      <AgreementForm
        entity={existing()}
        onSave={vi.fn()}
        metadataSource={metadataSource(['read', 'write'])}
      />,
    );

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /guardar/i })).toBeEnabled(),
    );
  });

  it('summarizes the rates in read mode rather than rendering inputs', async () => {
    renderForm(
      <AgreementForm
        entity={existing()}
        onSave={vi.fn()}
        metadataSource={metadataSource(['read'])}
      />,
    );

    await waitFor(() => expect(screen.getByText('counter: 0')).toBeVisible());
  });

  it('says so when a record carries no per-channel rates', async () => {
    const bare = new Agreement('acme', 500);
    bare.id = 'agreement-bare';

    renderForm(
      <AgreementForm
        entity={bare}
        onSave={vi.fn()}
        metadataSource={metadataSource(['read'])}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText(/sin tarifas por canal/i)).toBeVisible(),
    );
  });
});
