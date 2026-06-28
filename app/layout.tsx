import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Private Article Reader',
  description: 'Fetch and read any article without trackers or clutter.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Tailwind CDN — same approach as the original, keeps zero build config */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="https://cdn.tailwindcss.com" />
      </head>
      <body className="bg-gray-100">{children}</body>
    </html>
  );
}
