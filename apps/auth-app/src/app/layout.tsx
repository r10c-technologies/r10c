import './global.css';

import { Providers } from './providers';

export const metadata = {
  title: 'Auth · r10c',
  description: 'Authentication for the r10c marketplace fleet',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="auth" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
