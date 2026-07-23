'use client';

import { Button } from '@r10c/entifix-react-controls';
import { useState } from 'react';

/** Posts to the logout route (revoke + clear cookies), then leaves for sign-in. */
export function LogoutButton() {
  const [pending, setPending] = useState(false);

  async function onLogout() {
    setPending(true);
    const res = await fetch('/api/auth/logout', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    window.location.href = data.redirect ?? '/';
  }

  return (
    <Button variant="secondary" onClick={onLogout} disabled={pending}>
      {pending ? 'Signing out…' : 'Sign out'}
    </Button>
  );
}
