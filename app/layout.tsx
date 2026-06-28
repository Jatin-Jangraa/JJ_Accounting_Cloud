import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'JJ Accounting Cloud',
  description: 'Secure online dashboard for JJ Accounting data',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
