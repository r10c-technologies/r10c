'use client';

import { Radio, RadioGroup } from '@headlessui/react';

import { useT } from '../../../i18n';
import { useTheme } from '../../../theme';
import { cn } from '../../utils/cn';

/** Headless UI RadioGroup bound to the ThemeProvider. Options + labels come
 *  from the provider's registry, so it adapts to each app's theme set. */
export function ThemeSwitcher({ className }: { className?: string }) {
  const t = useT();
  const { theme, setTheme, themes } = useTheme();

  return (
    <RadioGroup
      value={theme}
      onChange={setTheme}
      aria-label={t('theme.label')}
      className={cn('flex flex-wrap gap-2xs', className)}
    >
      {themes.map(option => (
        <Radio
          key={option.id}
          value={option.id}
          className={cn(
            'cursor-pointer rounded-lg border border-border px-s py-2xs text-step-0',
            'transition duration-200 ease-smooth active:scale-[0.97]',
            'text-content hover:border-primary hover:shadow-raised',
            'focus-ring',
            'data-checked:border-primary data-checked:bg-primary data-checked:text-primary-content data-checked:shadow-card',
          )}
        >
          {option.label}
        </Radio>
      ))}
    </RadioGroup>
  );
}
