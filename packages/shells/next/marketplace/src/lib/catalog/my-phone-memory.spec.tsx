import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ForgetMyPhoneLink,
  MY_PHONE_KEY,
  MY_PHONE_RESTORED_KEY,
  RememberMyPhone,
} from './my-phone-memory';

const replace = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }));

const KNOWN = ['dm-1', 'dm-2'];

beforeEach(() => {
  replace.mockClear();
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, '', '/es/search?q=funda&page=2');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RememberMyPhone', () => {
  it('remembers the phone the listing is filtered by', () => {
    render(<RememberMyPhone chosen="dm-2" known={KNOWN} />);

    expect(localStorage.getItem(MY_PHONE_KEY)).toBe('dm-2');
    expect(replace).not.toHaveBeenCalled();
  });

  it('puts the remembered phone back on the first listing of a visit', () => {
    localStorage.setItem(MY_PHONE_KEY, 'dm-1');

    render(<RememberMyPhone chosen={undefined} known={KNOWN} />);

    expect(replace).toHaveBeenCalledWith('/es/search?q=funda&model=dm-1');
  });

  it('offers it once a visit, so clearing it sticks', () => {
    localStorage.setItem(MY_PHONE_KEY, 'dm-1');
    sessionStorage.setItem(MY_PHONE_RESTORED_KEY, '1');

    render(<RememberMyPhone chosen={undefined} known={KNOWN} />);

    expect(replace).not.toHaveBeenCalled();
  });

  it('does nothing when no phone was ever chosen', () => {
    render(<RememberMyPhone chosen={undefined} known={KNOWN} />);

    expect(replace).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(MY_PHONE_RESTORED_KEY)).toBe('1');
  });

  it('forgets a phone the store no longer offers', () => {
    localStorage.setItem(MY_PHONE_KEY, 'dm-gone');

    render(<RememberMyPhone chosen={undefined} known={KNOWN} />);

    expect(replace).not.toHaveBeenCalled();
    expect(localStorage.getItem(MY_PHONE_KEY)).toBeNull();
  });

  it('treats storage that throws as nothing remembered', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    render(<RememberMyPhone chosen={undefined} known={KNOWN} />);

    expect(replace).not.toHaveBeenCalled();
  });
});

describe('ForgetMyPhoneLink', () => {
  it('forgets the phone on the way back to every product', async () => {
    localStorage.setItem(MY_PHONE_KEY, 'dm-1');
    render(<ForgetMyPhoneLink href="/es/search">{'Quitar'}</ForgetMyPhoneLink>);

    const link = screen.getByRole('link', { name: 'Quitar' });
    link.addEventListener('click', event => event.preventDefault());
    await userEvent.click(link);

    expect(localStorage.getItem(MY_PHONE_KEY)).toBeNull();
  });
});
