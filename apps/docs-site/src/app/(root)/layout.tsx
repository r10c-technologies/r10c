import '../global.css';

import type { ReactNode } from 'react';

import { docsCopy } from '../../content/copy';

export const metadata = {
  title: docsCopy('es').title,
  description: docsCopy('es').description,
};

/**
 * The bare address `/` belongs to neither language: it is a root layout of its
 * own, with one choice on it, because a static export has no server to
 * negotiate a language with.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es" data-theme="aurora" data-scale="fixed">
      <body>{children}</body>
    </html>
  );
}
