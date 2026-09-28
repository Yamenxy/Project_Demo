import type { ReactNode } from 'react';

// Arabic (RTL) is the default locale. Locale routing and translations arrive with next-intl (Phase 1, task 15).
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
