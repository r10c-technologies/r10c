import { DeviceModel } from '@r10c/business-ts-catalog-reference';
import { parseSearch } from '@r10c/implementation-marketplace-catalog-next';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MyPhone } from './my-phone';

const replace = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }));

const model = (id: string, name: string) => {
  const one = new DeviceModel(name);
  one.id = id;
  return one;
};

const MODELS = [model('dm-1', 'Galaxy A15'), model('dm-2', 'iPhone 15')];
const LABELS = {
  label: 'Mi teléfono',
  choose: 'Elige tu modelo',
  apply: 'Ver lo que le queda',
  showing: 'Mostrando lo que le queda a tu Galaxy A15.',
  forget: 'Quitar',
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('MyPhone', () => {
  it('asks for a phone with a GET form that keeps the other filters', () => {
    const { container } = render(
      <MyPhone
        href="/es/search"
        state={parseSearch({ q: 'funda', page: '2' }, 'es')}
        models={MODELS}
        labels={LABELS}
      />,
    );

    const form = container.querySelector('form');
    expect(form).toHaveAttribute('method', 'get');
    expect(form).toHaveAttribute('action', '/es/search');
    expect(
      screen.getByRole('combobox', { name: 'Mi teléfono' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'iPhone 15' })).toHaveValue(
      'dm-2',
    );
    // The search carries over; the page starts again.
    expect(
      [...container.querySelectorAll('input[type="hidden"]')].map(input => [
        input.getAttribute('name'),
        input.getAttribute('value'),
      ]),
    ).toEqual([['q', 'funda']]);
  });

  it('says which phone it shows for, and offers to clear it', () => {
    render(
      <MyPhone
        href="/es/search"
        state={parseSearch({ q: 'funda', model: 'dm-1' }, 'es')}
        models={MODELS}
        labels={LABELS}
      />,
    );

    expect(screen.getByText(LABELS.showing)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Quitar' })).toHaveAttribute(
      'href',
      '/es/search?q=funda',
    );
    expect(localStorage.getItem('r10c:my-phone')).toBe('dm-1');
  });

  it('renders nothing when there are no phones to choose from', () => {
    const { container } = render(
      <MyPhone
        href="/es/search"
        state={parseSearch({}, 'es')}
        models={[]}
        labels={LABELS}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
