// Server Component — reads env vars at request time, no client bundle bloat.
// The history panel and its localStorage logic are injected as a plain <script>
// (same pattern as the original Worker) to avoid shipping a client component
// just for localStorage.

const HISTORY_SCRIPT = `
document.addEventListener('DOMContentLoaded', function() {
  const KEY = 'linkHistory';
  const form = document.getElementById('article-form');
  const input = document.getElementById('article-url');
  const list = document.getElementById('history-list');
  const clearBtn = document.getElementById('clear-history');

  function readHistory() {
    try {
      const v = localStorage.getItem(KEY);
      const p = v ? JSON.parse(v) : [];
      return Array.isArray(p) ? p : [];
    } catch { return []; }
  }

  function writeHistory(items) {
    localStorage.setItem(KEY, JSON.stringify(items));
  }

  function renderHistory() {
    const items = readHistory();
    list.innerHTML = '';
    if (!items.length) {
      const li = document.createElement('li');
      li.className = 'py-3 text-sm text-gray-500';
      li.textContent = 'No history yet.';
      list.appendChild(li);
      return;
    }
    items.slice(0, 20).forEach(function (entry) {
      if (!entry || typeof entry.link !== 'string') return;
      const li = document.createElement('li');
      li.className = 'py-3 flex items-start justify-between gap-4';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'text-left text-blue-600 hover:underline break-all';
      btn.textContent = entry.link;
      btn.addEventListener('click', function () {
        input.value = entry.link;
        input.focus();
      });

      const date = document.createElement('span');
      date.className = 'shrink-0 text-sm text-gray-500';
      try { date.textContent = new Date(entry.date).toLocaleString('en-GB'); }
      catch { date.textContent = entry.date; }

      li.appendChild(btn);
      li.appendChild(date);
      list.appendChild(li);
    });
  }

  form.addEventListener('submit', function () {
    const url = input.value.trim();
    if (!url) return;
    const entry = { link: url, date: new Date().toISOString() };
    const history = readHistory().filter(function (e) { return e && e.link !== url; });
    history.unshift(entry);
    writeHistory(history.slice(0, 100));
  });

  clearBtn.addEventListener('click', function () {
    localStorage.removeItem(KEY);
    renderHistory();
  });

  renderHistory();
})();
`;

export default function HomePage() {
  const turnstileEnabled = process.env.TURNSTILE_ENABLED === 'true';
  const siteKey = process.env.TURNSTILE_SITE_KEY ?? '';

  if (turnstileEnabled && !siteKey) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-8 font-sans text-red-600">
        Configuration error: <code>TURNSTILE_SITE_KEY</code> is not set.
      </div>
    );
  }

  // When Turnstile is enabled the form must POST so the token stays in the body.
  // When disabled, GET gives the user a shareable /article?url=… link directly.
  const formMethod = turnstileEnabled ? 'POST' : 'GET';

  return (
    <>
      {turnstileEnabled && (
        // eslint-disable-next-line @next/next/no-sync-scripts
        <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer />
      )}

      <div className="max-w-5xl mx-auto px-4 font-sans">
        <nav className="flex flex-col lg:flex-row items-center gap-4 py-4 border-b border-gray-300">
          <a href="/" className="flex-1 text-lg font-bold">Private Article Reader</a>
          <div className="flex gap-6">
            <a href="/#how-it-works" className="hover:underline">How it works ?</a>
          </div>
        </nav>

        <main className="my-8 space-y-8">
          {/* ── URL form ── */}
          <div className="bg-white rounded-lg shadow p-6">
            <form id="article-form" action="/article" method={formMethod} className="flex flex-col gap-4">
              <input
                id="article-url"
                type="url"
                name="url"
                required
                placeholder="Enter article URL (e.g. https://example.com/news)"
                className="border-2 rounded px-3 py-2 outline-none focus:border-gray-400"
              />
              {turnstileEnabled && (
                <div className="cf-turnstile" data-sitekey={siteKey} data-theme="light" />
              )}
              <button
                type="submit"
                className="bg-black text-white py-2 rounded hover:bg-gray-800 transition"
              >
                Load Article
              </button>
            </form>
          </div>

          {/* ── History ── */}
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between gap-4 mb-4">
              <h2 className="text-lg font-bold">History</h2>
              <button
                id="clear-history"
                type="button"
                className="px-4 py-2 text-white bg-red-600 rounded hover:bg-red-800"
              >
                Clear History
              </button>
            </div>
            <ul
              id="history-list"
              className="max-h-56 overflow-y-auto divide-y divide-gray-200"
            />
          </div>

          {/* ── How it works ── */}
          <div id="how-it-works" className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-bold mb-4">How it works ?</h2>
            <div className="space-y-3">
              {[
                'You enter a URL (News / Blog).',
                'Our server fetches the page and strips trackers and scripts.',
                'We display it in an easy‑to‑read format.',
              ].map((step, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="bg-black text-white rounded-full w-6 h-6 flex items-center justify-center text-sm font-bold">
                    {i + 1}
                  </span>
                  <span>{step}</span>
                </div>
              ))}
            </div>
          </div>
        </main>
      </div>

      {/* History panel — vanilla JS, no React state needed */}
      <script dangerouslySetInnerHTML={{ __html: HISTORY_SCRIPT }} />
    </>
  );
}
