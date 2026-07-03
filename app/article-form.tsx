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

// Client‑side URL validation – only allow http(s)
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
  const [urlError, setUrlError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const renderedRef = useRef(false);

  // Load history on mount
  useEffect(() => {
    setHistory(readHistory());
  }, []);

  // Render Turnstile when the script loads
  const handleTurnstileLoad = () => {
    if (!containerRef.current || !window.turnstile || renderedRef.current) return;
    const widgetId = window.turnstile.render(containerRef.current, {
      sitekey: siteKey,
      theme: 'light',
      callback: (token: string) => {
        setIsVerified(true);
        setUrlError(null); // clear any previous error
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

  // Cleanup Turnstile on unmount
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
    // Prevent submission if CAPTCHA not verified
    if (turnstileEnabled && !isVerified) {
      e.preventDefault();
      alert('Please complete the CAPTCHA verification first.');
      return;
    }

    // Validate URL
    if (!url) {
      e.preventDefault();
      setUrlError('Please enter a URL.');
      return;
    }
    if (!isValidUrl(url)) {
      e.preventDefault();
      setUrlError('Please enter a valid HTTP or HTTPS URL.');
      return;
    }
    setUrlError(null);

    // Update history using current state, avoid re‑reading localStorage
    const entry = { link: url, date: new Date().toISOString() };
    const next = [entry, ...history.filter(e => e.link !== url)].slice(0, HISTORY_LIMIT);
    localStorage.setItem(KEY, JSON.stringify(next));
    setHistory(next);
  }

  function clearHistory() {
    localStorage.removeItem(KEY);
    setHistory([]);
  }

  // Memoize history list to avoid unnecessary re‑renders
  const historyItems = useMemo(() => {
    if (history.length === 0) {
      return <li className="py-3 text-sm text-gray-500">No history yet.</li>;
    }
    return history.map((entry) => (
      <li key={entry.link + entry.date} className="py-3 flex items-start justify-between gap-4">
        <button
          type="button"
          className="text-left text-blue-600 hover:underline break-all"
          onClick={() => setUrl(entry.link)}
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
      {/* Load Turnstile script only when needed */}
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
          <div className="flex flex-row items-center gap-2">
            <div className="flex-1 min-w-0">
              <label htmlFor="article-url" className="sr-only">
                Article URL
              </label>
              <input
                id="article-url"
                type="url"
                name="url"
                required
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  // Clear error when user types
                  if (urlError) setUrlError(null);
                }}
                placeholder="Enter article URL (e.g. https://example.com/news)"
                className="w-full border-2 rounded px-3 py-2 outline-none focus:border-gray-400"
                aria-describedby={urlError ? 'url-error' : undefined}
              />
              {urlError && (
                <p id="url-error" className="mt-1 text-sm text-red-600">
                  {urlError}
                </p>
              )}
            </div>
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
          </div>

          {turnstileEnabled && (
            <>
              <div ref={containerRef} /> {/* No data-* attributes to avoid auto-render */}
              <div aria-live="polite" aria-atomic="true" className="text-sm mt-1">
                {!isVerified && (
                  <span className="text-gray-600">Please complete the CAPTCHA verification.</span>
                )}
                {isVerified && (
                  <span className="text-green-600">✓ Verification successful</span>
                )}
              </div>
            </>
          )}
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
          {historyItems}
        </ul>
      </div>
    </>
  );
}
