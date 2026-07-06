'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Script from 'next/script';

const KEY = 'linkHistory';
const HISTORY_LIMIT = 100;

interface HistoryEntry { link: string; date: string; }

function readHistory(): HistoryEntry[] {
  try {
    const v = localStorage.getItem(KEY);
    const p = v ? JSON.parse(v) : [];
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, params: {
        sitekey: string;
        theme?: 'light' | 'dark';
        callback: (token: string) => void;
        'error-callback'?: () => void;
        'expired-callback'?: () => void;
      }) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

export default function ArticleForm({
  turnstileEnabled,
  siteKey,
  initialUrl,
  nonce,
}: {
  turnstileEnabled: boolean;
  siteKey: string;
  initialUrl?: string;
  nonce?: string;
}) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [url, setUrl] = useState(initialUrl ?? '');
  const [isVerified, setIsVerified] = useState(!turnstileEnabled);
  const [formError, setFormError] = useState<string | null>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const renderedRef = useRef(false);

  useEffect(() => {
    setHistory(readHistory());
  }, []);

  const handleTurnstileLoad = () => {
    if (!containerRef.current || !window.turnstile || renderedRef.current) return;
    const widgetId = window.turnstile.render(containerRef.current, {
      sitekey: siteKey,
      theme: 'light',
      callback: (token: string) => {
        setIsVerified(true);
        setFormError(null);
      },
      'error-callback': () => {
        setIsVerified(false);
      },
      'expired-callback': () => {
        setIsVerified(false);
      },
    });
    widgetIdRef.current = widgetId;
    renderedRef.current = true;
  };

  useEffect(() => {
    return () => {
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
        renderedRef.current = false;
      }
    };
  }, []);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (turnstileEnabled && !isVerified) {
      e.preventDefault();
      setFormError('Please complete the CAPTCHA verification first.');
      return;
    }
    if (!url) {
      e.preventDefault();
      setFormError('Please enter a URL.');
      return;
    }
    if (!isValidUrl(url)) {
      e.preventDefault();
      setFormError('Please enter a valid HTTP or HTTPS URL.');
      return;
    }
    setFormError(null);

    const entry = { link: url, date: new Date().toISOString() };
    const next = [entry, ...history.filter(e => e.link !== url)].slice(0, HISTORY_LIMIT);
    localStorage.setItem(KEY, JSON.stringify(next));
    setHistory(next);
  }

  function clearHistory() {
    localStorage.removeItem(KEY);
    setHistory([]);
  }

  const historyItems = useMemo(() => {
    if (history.length === 0) {
      return <li className="py-3 text-sm text-gray-500">No history yet.</li>;
    }
    return history.map((entry) => (
      <li key={entry.link + entry.date} className="py-3 flex items-start justify-between gap-4">
        <button
          type="button"
          className="text-left text-blue-600 hover:underline break-all"
          onClick={() => {
            setUrl(entry.link);
            setIsHistoryOpen(false);
          }}
          aria-label={`Load ${entry.link}`}
        >
          {entry.link}
        </button>
        <span className="shrink-0 text-sm text-gray-500">
          {new Date(entry.date).toLocaleString('en-GB')}
        </span>
      </li>
    ));
  }, [history]);

  return (
    <>
      {turnstileEnabled && (
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js"
          strategy="afterInteractive"
          nonce={nonce}
          onLoad={handleTurnstileLoad}
        />
      )}

      <div className="bg-white rounded-lg shadow p-6">
        <form action="/article" method="post" onSubmit={handleSubmit} className="space-y-3">
          {/* --- UPDATED LAYOUT --- */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex-1 min-w-[200px]">
              <label htmlFor="article-url" className="sr-only">Article URL</label>
              <input
                id="article-url"
                type="url"
                name="url"
                required
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  if (formError) setFormError(null);
                }}
                placeholder="Enter article URL (e.g. https://example.com/news)"
                className="w-full border-2 rounded px-3 py-2 outline-none focus:border-gray-400"
                aria-describedby={formError ? 'form-error' : undefined}
              />
              {formError && (
                <p id="form-error" className="mt-1 text-sm text-red-600">{formError}</p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
              <label className="flex items-center gap-1 whitespace-nowrap text-sm cursor-pointer">
                <input type="checkbox" name="latest" value="1" />
                LIVE
              </label>

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

              <button
                type="button"
                onClick={() => setIsHistoryOpen(true)}
                className="px-3 py-2 rounded bg-gray-200 hover:bg-gray-300 text-sm flex items-center gap-1"
                aria-label="Open history"
              >
                📚 History
              </button>
            </div>
          </div>
          {/* --- END UPDATED LAYOUT --- */}

          {turnstileEnabled && <div ref={containerRef} />}
        </form>
      </div>

      {isHistoryOpen && (
        <div
          className="fixed inset-0 z-50 flex justify-end"
          role="dialog"
          aria-modal="true"
          aria-label="History sidebar"
        >
          <div
            className="fixed inset-0 bg-black/30"
            onClick={() => setIsHistoryOpen(false)}
            aria-hidden="true"
          />
          <div
            className="relative w-80 max-w-full h-full bg-white shadow-xl transform transition-transform duration-300 ease-in-out"
            style={{ transform: 'translateX(0)' }}
          >
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <h2 className="text-lg font-bold">History</h2>
              <button
                type="button"
                onClick={() => setIsHistoryOpen(false)}
                className="text-gray-500 hover:text-gray-700 text-xl"
                aria-label="Close history"
              >
                ✕
              </button>
            </div>
            <div className="p-4">
              <button
                type="button"
                onClick={clearHistory}
                className="mb-4 px-4 py-2 text-white bg-red-600 rounded hover:bg-red-800 text-sm"
              >
                Clear History
              </button>
              <ul className="max-h-[calc(100vh-180px)] overflow-y-auto divide-y divide-gray-200">
                {historyItems}
              </ul>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
