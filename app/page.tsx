import ArticleForm from './article-form';

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const initialUrl = typeof sp.url === 'string' ? sp.url : undefined;

  const turnstileEnabled = process.env.TURNSTILE_ENABLED === 'true';
  const siteKey = process.env.TURNSTILE_SITE_KEY ?? '';

  if (turnstileEnabled && !siteKey) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-8 font-sans text-red-600">
        Configuration error: <code>TURNSTILE_SITE_KEY</code> is not set.
      </div>
    );
  }

  return (
    <>
      {turnstileEnabled && (
        // eslint-disable-next-line @next/next/no-sync-scripts
        <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer />
      )}

      <div className="max-w-5xl mx-auto px-4 font-sans">
        <nav class="flex justify-center items-center py-4 border-b border-gray-300">
          <a href="/" class="text-lg font-bold">Private Article Reader</a>
        </nav>

        <main className="my-8 space-y-8">
          <ArticleForm turnstileEnabled={turnstileEnabled} siteKey={siteKey} initialUrl={initialUrl} />

          <div id="how-it-works" className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-bold mb-4">How it works ?</h2>
            <div className="space-y-3">
              {[
                'You enter a URL (News / Blog).',
                'Our server fetches the page and strips trackers and scripts.',
                'We display it in an easy‑to‑read format.',
              ].map((step, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="bg-black text-white rounded-full w-6 h-6 flex-shrink-0 flex items-center justify-center text-sm font-bold">
                    {i + 1}
                  </span>
                  <span className="pt-0.5">{step}</span>
                </div>

              ))}
            </div>
          </div>
        </main>
      </div>
    </>
  );
}
