'use client';

import { Button, useT } from '@r10c/entifix-react-controls';
import { useState } from 'react';

/** Posts to the logout route (revoke + clear cookies), then leaves for sign-in. */
export function LogoutButton() {
  const t = useT('app');
  const [pending, setPending] = useState(false);

  async function onLogout() {
    setPending(true);
    const res = await fetch('/api/auth/logout', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    window.location.href = data.redirect ?? '/';
  }

  return (
    <Button variant="secondary" onClick={onLogout} disabled={pending}>
      {pending ? t('admin.account.signingOut') : t('admin.account.signOut')}
    </Button>
  );
}
