'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect } from 'react';

/** Where the last phone a buyer chose is remembered, on their own device. */
export const MY_PHONE_KEY = 'r10c:my-phone';
/** Set once a visit has been offered its remembered phone, so clearing it sticks. */
export const MY_PHONE_RESTORED_KEY = 'r10c:my-phone-restored';

/**
 * A storage call that can throw — a private window, blocked site data — is a
 * convenience lost, never a broken listing.
 */
const safely = <A,>(run: () => A): A | undefined => {
  try {
    return run();
  } catch {
    return undefined;
  }
};

/**
 * Remembers the phone a listing is filtered by, and on the first listing of a
 * visit with none chosen, puts the remembered one back into the address.
 *
 * Once per visit, so "Quitar" and a plain navigation stay what the buyer did.
 * A remembered model the vocabulary no longer offers is forgotten instead.
 */
export function RememberMyPhone({
  chosen,
  known,
}: {
  readonly chosen: string | undefined;
  readonly known: readonly string[];
}) {
  const router = useRouter();

  useEffect(() => {
    if (chosen !== undefined) {
      safely(() => localStorage.setItem(MY_PHONE_KEY, chosen));
      return;
    }
    if (safely(() => sessionStorage.getItem(MY_PHONE_RESTORED_KEY)) !== null) {
      return;
    }
    safely(() => sessionStorage.setItem(MY_PHONE_RESTORED_KEY, '1'));
    const remembered = safely(() => localStorage.getItem(MY_PHONE_KEY));
    if (remembered === null || remembered === undefined) return;
    if (!known.includes(remembered)) {
      safely(() => localStorage.removeItem(MY_PHONE_KEY));
      return;
    }
    // Read here rather than through `useSearchParams`, which would need a
    // Suspense boundary on every prerendered listing.
    const next = new URLSearchParams(window.location.search);
    next.set('model', remembered);
    next.delete('page');
    router.replace(`${window.location.pathname}?${next.toString()}`);
  }, [chosen, known, router]);

  return null;
}

/** "Quitar": back to every product, and the phone is no longer remembered. */
export function ForgetMyPhoneLink({
  href,
  children,
}: {
  readonly href: string;
  readonly children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="text-primary underline focus-ring"
      onClick={() => safely(() => localStorage.removeItem(MY_PHONE_KEY))}
    >
      {children}
    </Link>
  );
}
