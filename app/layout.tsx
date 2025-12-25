import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Global Counter Click Game',
  description: 'A real-time global counter click game with team competition',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

