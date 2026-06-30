import type { Metadata } from 'next';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';

export const metadata: Metadata = {
  title: 'Private Article Reader',
  description: 'Fetch and read any article without trackers or clutter.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="stylesheet" href="/tailwind.css" />
      </head>
      <body className="bg-gray-100">
        {children}
        <Analytics />
        <SpeedInsights/>
      </body>
    </html>
  );
}
