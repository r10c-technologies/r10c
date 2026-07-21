import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Checkbox, Select, TextInput } from './field.js';

describe('TextInput', () => {
  it('renders an input the caller can type into', async () => {
    const user = userEvent.setup();
    render(<TextInput aria-label="Name" />);

    await user.type(screen.getByLabelText('Name'), 'Acme');

    expect(screen.getByLabelText('Name')).toHaveValue('Acme');
  });

  it('forwards its props through', () => {
    render(<TextInput aria-label="Name" placeholder="Type here" disabled />);

    expect(screen.getByLabelText('Name')).toBeDisabled();
    expect(screen.getByLabelText('Name')).toHaveAttribute('placeholder', 'Type here');
  });

  it('keeps the caller’s className alongside the shared control styling', () => {
    render(<TextInput aria-label="Name" className="custom" />);

    const classes = screen.getByLabelText('Name').className.split(/\s+/);
    expect(classes).toEqual(expect.arrayContaining(['custom', 'rounded-lg']));
  });
});

describe('Select', () => {
  it('renders a select the caller can choose from', async () => {
    const user = userEvent.setup();
    render(
      <Select aria-label="Operator">
        <option value="eq">equals</option>
        <option value="ne">differs</option>
      </Select>,
    );

    await user.selectOptions(screen.getByLabelText('Operator'), 'ne');

    expect(screen.getByLabelText('Operator')).toHaveValue('ne');
  });

  it('keeps the caller’s className', () => {
    render(<Select aria-label="Operator" className="custom" />);

    expect(screen.getByLabelText('Operator').className).toContain('custom');
  });
});

describe('Checkbox', () => {
  // The label is a required prop and is rendered as the wrapping <label>, so
  // the control is always reachable by its accessible name.
  it('is reachable by its label', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Checkbox label="Visible" onChange={onChange} />);

    await user.click(screen.getByLabelText('Visible'));

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('reflects the checked state it was given', () => {
    render(<Checkbox label="Visible" checked readOnly />);

    expect(screen.getByLabelText('Visible')).toBeChecked();
  });

  it('keeps the caller’s className on the label, not the input', () => {
    render(<Checkbox label="Visible" className="custom" />);

    expect(screen.getByText('Visible').className).toContain('custom');
    expect(screen.getByLabelText('Visible').className).not.toContain('custom');
  });
});
