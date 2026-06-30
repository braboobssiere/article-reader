'use client';

import { useEffect, useState } from 'react';

const KEY = 'linkHistory';
const HISTORY_LIMIT = 100;

interface HistoryEntry { link: string; date: string; }

function readHistory(): HistoryEntry[] {
  try {
    const v = localStorage.getItem(KEY);
    const p = v ? JSON.parse(v) : [];
    return Array.isArray(p) ? p : [];
  } catch { return []; }
}

export default function ArticleForm({
  turnstileEnabled,
  siteKey,
  initialUrl,
}: {
  turnstileEnabled: boolean;
  siteKey: string;
  initialUrl?: string;
}) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [url, setUrl] = useState(initialUrl ?? '');
  const [isVerified, setIsVerified] = useState(!turnstileEnabled); // verified if no CAPTCHA needed

  // Register the Turnstile callback globally
  useEffect(() => {
    if (turnstileEnabled) {
      // Define the callback that the Turnstile widget will call on success
      (window as any).turnstileCallback = () => {
        setIsVerified(true);
      };
      // Clean up when component unmounts
      return () => {
        delete (window as any).turnstileCallback;
      };
    }
  }, [turnstileEnabled]);

  // Load history from localStorage on mount
  useEffect(() => {
    setHistory(readHistory());
  }, []);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (turnstileEnabled && !isVerified) {
      e.preventDefault(); // stop form submission
      alert('Please complete the CAPTCHA verification first.');
      return;
    }
    // Save history
    if (!url) {
      e.preventDefault();
      return;
    }
    const entry = { link: url, date: new Date().toISOString() };
    const next = [entry, ...readHistory().filter(e => e.link !== url)].slice(0, HISTORY_LIMIT);
    localStorage.setItem(KEY, JSON.stringify(next));
    setHistory(next);
    // let the form submit natively
  }

  function clearHistory() {
    localStorage.removeItem(KEY);
    setHistory([]);
  }

  return (
    <>
      {/* Form section */}
      <div className="bg-white rounded-lg shadow p-6">
        <form
          action="/article"
          method="post"
          onSubmit={handleSubmit}
          className="space-y-3"
        >
          <div className="flex flex-row gap-2">
            <input
              type="url"
              name="url"
              required
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="Enter article URL (e.g. https://example.com/news)"
              className="flex-1 min-w-0 border-2 rounded px-3 py-2 outline-none focus:border-gray-400"
            />
            <button
              type="submit"
              disabled={turnstileEnabled && !isVerified}
              className={`
                px-4 py-2 rounded transition whitespace-nowrap text-sm
                ${turnstileEnabled && !isVerified
                  ? 'bg-gray-400 text-gray-200 cursor-not-allowed'
                  : 'bg-black text-white hover:bg-gray-800'
                }
              `}
            >
              Load Article
            </button>
          </div>

          {/* Cloudflare Turnstile – only when enabled */}
          {turnstileEnabled && (
            <div
              className="cf-turnstile"
              data-sitekey={siteKey}
              data-theme="light"
              data-callback="turnstileCallback"
            />
          )}
        </form>
      </div>

      {/* History section – unchanged */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between gap-4 mb-4">
          <h2 className="text-lg font-bold">History</h2>
          <button
            type="button"
            onClick={clearHistory}
            className="px-4 py-2 text-white bg-red-600 rounded hover:bg-red-800"
          >
            Clear History
          </button>
        </div>
        <ul className="max-h-56 overflow-y-auto divide-y divide-gray-200">
          {history.length === 0 ? (
            <li className="py-3 text-sm text-gray-500">No history yet.</li>
          ) : (
            history.map((entry, i) => (
              <li key={i} className="py-3 flex items-start justify-between gap-4">
                <button
                  type="button"
                  className="text-left text-blue-600 hover:underline break-all"
                  onClick={() => setUrl(entry.link)}
                >
                  {entry.link}
                </button>
                <span className="shrink-0 text-sm text-gray-500">
                  {new Date(entry.date).toLocaleString('en-GB')}
                </span>
              </li>
            ))
          )}
        </ul>
      </div>
    </>
  );
}
