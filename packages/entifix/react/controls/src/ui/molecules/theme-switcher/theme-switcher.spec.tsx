import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { ThemeProvider } from '../../../theme/theme-context.js';
import type { ThemeOption } from '../../../theme/types.js';
import { ThemeSwitcher } from './theme-switcher.js';

const themes: ThemeOption[] = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];

const renderSwitcher = (className?: string) =>
  render(
    <ThemeProvider themes={themes}>
      <ThemeSwitcher className={className} />
    </ThemeProvider>,
  );

beforeEach(() => {
  window.localStorage.clear();
});

describe('ThemeSwitcher', () => {
  // Options come from the provider's registry rather than a hardcoded list, so
  // each app's own theme set drives the control.
  it('offers one option per registered theme', () => {
    renderSwitcher();

    expect(screen.getByRole('radio', { name: 'Light' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeInTheDocument();
  });

  it('is labelled for assistive technology', () => {
    renderSwitcher();

    expect(screen.getByRole('radiogroup')).toHaveAccessibleName('Theme');
  });

  it('marks the active theme as checked', () => {
    renderSwitcher();

    expect(screen.getByRole('radio', { name: 'Light' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Dark' })).not.toBeChecked();
  });

  it('switches the theme when another option is chosen', async () => {
    const user = userEvent.setup();
    renderSwitcher();

    await user.click(screen.getByRole('radio', { name: 'Dark' }));

    expect(screen.getByRole('radio', { name: 'Dark' })).toBeChecked();
    expect(document.documentElement.dataset['theme']).toBe('dark');
  });

  it('keeps the caller’s className', () => {
    renderSwitcher('custom');

    expect(screen.getByRole('radiogroup').className).toContain('custom');
  });
});
