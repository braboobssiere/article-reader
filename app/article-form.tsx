'use client';

import { useEffect, useState } from 'react';

const KEY = 'linkHistory';

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
}: {
  turnstileEnabled: boolean;
  siteKey: string;
}) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [url, setUrl] = useState('');

  useEffect(() => {
    setHistory(readHistory());
  }, []);

  function handleSubmit() {
    if (!url) return;
    const entry = { link: url, date: new Date().toISOString() };
    const next = [entry, ...readHistory().filter(e => e.link !== url)].slice(0, 100);
    localStorage.setItem(KEY, JSON.stringify(next));
  }

  function clearHistory() {
    localStorage.removeItem(KEY);
    setHistory([]);
  }

  return (
    <>
      <div className="bg-white rounded-lg shadow p-6">
        <form
          action="/article"
          method={turnstileEnabled ? 'POST' : 'GET'}
          className="flex flex-col gap-4"
          onSubmit={handleSubmit}
        >
          <input
            type="url"
            name="url"
            required
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="Enter article URL (e.g. https://example.com/news)"
            className="border-2 rounded px-3 py-2 outline-none focus:border-gray-400"
          />
          {turnstileEnabled && (
            <div className="cf-turnstile" data-sitekey={siteKey} data-theme="light" />
          )}
          <button type="submit" className="bg-black text-white py-2 rounded hover:bg-gray-800 transition">
            Load Article
          </button>
        </form>
      </div>

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
            history.slice(0, 20).map((entry, i) => (
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
