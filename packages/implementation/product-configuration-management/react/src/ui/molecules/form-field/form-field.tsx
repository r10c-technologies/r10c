import { Text } from '@r10c/entifix-react-controls';
import type { ReactNode } from 'react';

export interface FormFieldProps {
  label: string;
  htmlFor: string;
  children: ReactNode;
}

/**
 * Label + control pairing for the catalog forms.
 *
 * `entifix-react-controls` has no input atom yet, so these forms use native
 * `<input>`/`<select>` elements. This molecule keeps that decision in one place:
 * when a real field atom lands in the design system, only this file changes.
 */
export function FormField({ label, htmlFor, children }: FormFieldProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
      <label htmlFor={htmlFor}>
        <Text as="span">{label}</Text>
      </label>
      {children}
    </div>
  );
}

export const fieldStyle = {
  padding: '0.375rem 0.5rem',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--color-surface)',
  color: 'var(--color-content)',
} as const;
