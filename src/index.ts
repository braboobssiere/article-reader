import { Hono } from 'hono';
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { isPrivateIp, isBlockedHostname, normalizeUrlHostname } from 'ssrf-guard';

// ------------------------------
// Environment Bindings
// ------------------------------
interface Env {
  TURNSTILE_ENABLED?: string;    // "true" to enable Turnstile on the homepage form
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  ARTICLE_CACHE?: KVNamespace;
}

interface ArticleData {
  title: string;
  content: string;
  author: string | null;
  published: string | null;
  image: string | null;
  ttr: number;
}

interface CachedArticle extends ArticleData {
  fetchedAt: number;
}

// ------------------------------
// Cache
// ------------------------------
const memoryCache = new Map<string, { data: CachedArticle; expires: number }>();
const CACHE_TTL_SECONDS = 3600;

// ------------------------------
// Helpers
// ------------------------------
function computeReadingTime(html: string): number {
  const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const wordCount = text.split(/\s+/).length;
  return Math.ceil((wordCount / 200) * 60);
}

function sanitizeHtml(html: string): string {
  return html
    .replace(/<(script|iframe|object|embed)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '')
    .replace(/\s+href\s*=\s*["']\s*javascript:[^"']*["']/gi, '')
    .replace(/\s+srcdoc\s*=\s*["'][^"']*["']/gi, '');
}

function fallbackExtract(html: string): { title: string; content: string } {
  const { document } = parseHTML(`<body>${html}</body>`);
  const selectors = [
    'article',
    '[role="article"]',
    '.post-content',
    '.entry-content',
    '.article-content',
    '.content',
    '.main-content',
    '#content',
    '.post',
    '.blog-post'
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && el.innerHTML.trim().length > 100) {
      const title = document.querySelector('title')?.textContent || 'Untitled';
      return { title, content: el.innerHTML };
    }
  }
  const body = document.body;
  const toRemove = body.querySelectorAll('nav, header, footer, aside, .sidebar, .advertisement, .ads, .popup, .modal');
  toRemove.forEach(el => el.remove());
  const title = document.querySelector('title')?.textContent || 'Untitled';
  return { title, content: body.innerHTML };
}

function extractImageFromHtml(html: string, doc: Document): string | null {
  const metaSelectors = [
    'meta[property="og:image"]',
    'meta[name="twitter:image"]',
    'meta[property="og:image:secure_url"]',
  ];

  for (const sel of metaSelectors) {
    const meta = doc.querySelector(sel);
    const content = meta?.getAttribute('content');
    if (content?.startsWith('http')) return content;
  }

  const imgMatch = html.match(/<img\b[^>]*\bsrc\s*=\s*(["'])(https?:\/\/[^"'\s>]+)\1/i) ||
    html.match(/<img\b[^>]*\bsrc\s*=\s*(https?:\/\/[^\s>]+)/i);
  return imgMatch?.[2] || imgMatch?.[1] || null;
}

// SSRF protection using ssrf-guard (core)
function isBlockedHost(hostname: string): boolean {
  const normalized = normalizeUrlHostname(hostname);
  const policy = {
    exact: ['localhost', 'metadata.google.internal', 'metadata.azure.internal'],
    suffixes: ['.local', '.internal'],
  };
  return isPrivateIp(normalized) || isBlockedHostname(normalized, policy);
}

function validateUrl(rawUrl: string): URL {
  const url = new URL(rawUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http and https URLs are allowed');
  }
  if (isBlockedHost(url.hostname)) {
    throw new Error('Blocked host');
  }
  return url;
}

async function fetchAndParseArticle(url: string, env: Env): Promise<ArticleData> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PrivateArticleReader/1.0)' },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const html = await response.text();
    const { document } = parseHTML(html);

    let author: string | null = null;
    let published: string | null = null;

    const authorMeta = document.querySelector('meta[name="author"]')?.getAttribute('content') ||
      document.querySelector('meta[property="article:author"]')?.getAttribute('content');
    if (authorMeta) author = authorMeta;

    const dateMeta = document.querySelector('meta[property="article:published_time"]')?.getAttribute('content') ||
      document.querySelector('meta[name="publishdate"]')?.getAttribute('content');
    if (dateMeta) published = dateMeta;

    // Extract the image before Readability mutates the document.
    const image = extractImageFromHtml(html, document);

    const reader = new Readability(document);
    let parsed = reader.parse();
    let content = parsed?.content || '';

    if (!content || content.trim().length < 50) {
      const fallback = fallbackExtract(html);
      content = fallback.content;
      if (!parsed?.title) {
        parsed = { title: fallback.title, content: fallback.content, byline: null };
      }
    }

    if (!content || content.trim().length < 10) {
      throw new Error('Could not extract article content');
    }

    const sanitisedContent = sanitizeHtml(content);
    const ttr = computeReadingTime(sanitisedContent);

    return {
      title: parsed?.title || 'Untitled',
      content: sanitisedContent || content,
      author: author || parsed?.byline || null,
      published: published || null,
      image,
      ttr,
    };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Request timeout – the website took too long to respond');
    }
    throw new Error(`Extraction failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }
}

// ------------------------------
// Cache functions
// ------------------------------
async function getCachedArticle(url: string, env: Env): Promise<CachedArticle | null> {
  const now = Date.now();
  const mem = memoryCache.get(url);
  if (mem && mem.expires > now) return mem.data;
  if (env.ARTICLE_CACHE) {
    const kvData = await env.ARTICLE_CACHE.get(url, 'json') as CachedArticle | null;
    if (kvData && kvData.fetchedAt + CACHE_TTL_SECONDS * 1000 > now) {
      memoryCache.set(url, { data: kvData, expires: now + CACHE_TTL_SECONDS * 1000 });
      return kvData;
    }
  }
  return null;
}

async function setCachedArticle(url: string, data: ArticleData, env: Env): Promise<void> {
  const now = Date.now();
  const cached: CachedArticle = { ...data, fetchedAt: now };
  memoryCache.set(url, { data: cached, expires: now + CACHE_TTL_SECONDS * 1000 });
  if (env.ARTICLE_CACHE) {
    await env.ARTICLE_CACHE.put(url, JSON.stringify(cached), { expirationTtl: CACHE_TTL_SECONDS });
  }
}

// ------------------------------
// Turnstile verification (optional)
// ------------------------------
async function verifyTurnstile(token: string, ip: string, secretKey: string): Promise<boolean> {
  if (!secretKey) return false;

  const formData = new FormData();
  formData.append('secret', secretKey);
  formData.append('response', token);
  if (ip) formData.append('remoteip', ip);

  const result = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: formData,
  });
  const outcome = await result.json() as { success?: boolean };
  return outcome.success === true;
}

// ------------------------------
// HTML rendering helpers
// ------------------------------
function renderArticlePage(article: ArticleData, sourceUrl: string): string {
  const readingTime = Math.round(article.ttr / 60);
  const publishedDate = article.published ? new Date(article.published).toLocaleDateString() : 'Publishing time not found';
  const author = article.author || 'No author found';
  const imageHtml = article.image && !article.content.includes(article.image)
    ? `<img src="${escapeHtml(article.image)}" alt="${escapeHtml(article.title)}" class="w-full mx-auto my-5 rounded shadow" />`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(article.title)} – Private Article Reader</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    /* Reader variables */
    :root {
      --bg-color: #fbf4e8;
      --text-color: #5b4637;
      --prose-max-width: 65ch;
      --font-size-base: 18px;
    }

    body {
      background-color: var(--bg-color);
      color: var(--text-color);
      transition: background-color 0.2s, color 0.2s;
    }

    .prose {
      max-width: var(--prose-max-width);
      margin: 0 auto;
      line-height: 1.8;
      font-size: var(--font-size-base);
    }

    .prose p { margin-bottom: 1.2em; }
    .prose img { margin: 2em auto; border-radius: 0.5rem; }
    .prose h2, .prose h3 { font-weight: 600; margin-top: 1.5em; margin-bottom: 0.5em; }

    /* Toolbar */
    .reader-toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem 1rem;
      align-items: center;
      justify-content: center;
      padding: 0.75rem 1rem;
      background: rgba(255,255,255,0.6);
      border-radius: 9999px;
      margin-bottom: 1.5rem;
      backdrop-filter: blur(4px);
      box-shadow: 0 2px 8px rgba(0,0,0,0.05);
      transition: background 0.2s, border-color 0.2s;
    }
    .reader-toolbar button {
      background: transparent;
      border: 1px solid #ccc;
      border-radius: 9999px;
      padding: 0.25rem 0.75rem;
      font-size: 0.9rem;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s;
      color: inherit;
    }
    .reader-toolbar button:hover {
      background: rgba(0,0,0,0.08);
    }
    .reader-toolbar .active {
      background: #000;
      color: #fff;
      border-color: #000;
    }
    .reader-toolbar .active:hover {
      background: #333;
    }
    .reader-toolbar .group-label {
      font-size: 0.8rem;
      opacity: 0.7;
      margin-right: 0.2rem;
    }
    .reader-toolbar .width-group {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
    }

    /* Dark theme overrides */
    body.theme-dark .reader-toolbar {
      background: rgba(0,0,0,0.7);
      border-color: #444;
    }
    body.theme-dark .reader-toolbar button {
      border-color: #555;
      color: #ddd;
    }
    body.theme-dark .reader-toolbar button:hover {
      background: rgba(255,255,255,0.1);
    }
    body.theme-dark .reader-toolbar .active {
      background: #fff;
      color: #000;
      border-color: #fff;
    }
    body.theme-dark .reader-toolbar .active:hover {
      background: #ddd;
    }
    body.theme-dark nav {
      border-bottom-color: #444 !important;
    }
    body.theme-dark .source-link {
      background-color: #d97706 !important;
      color: #000 !important;
    }
    body.theme-dark .source-link:hover {
      background-color: #b45309 !important;
    }

    /* Mobile adjustments: full width, no card styling, hide width controls */
    @media (max-width: 768px) {
      .max-w-5xl {
        max-width: 100% !important;
        padding-left: 0 !important;
        padding-right: 0 !important;
      }
      .bg-white.rounded-lg.shadow.p-6 {
        border-radius: 0 !important;
        box-shadow: none !important;
        padding: 0.5rem !important;
      }
      .reader-toolbar {
        border-radius: 0.5rem;
        flex-wrap: wrap;
        gap: 0.25rem 0.5rem;
        padding: 0.5rem;
        background: rgba(255,255,255,0.8);
      }
      body.theme-dark .reader-toolbar {
        background: rgba(0,0,0,0.8);
      }
      .reader-toolbar .group-label {
        font-size: 0.7rem;
      }
      .reader-toolbar button {
        font-size: 0.8rem;
        padding: 0.15rem 0.5rem;
      }
      .reader-toolbar .width-group {
        display: none !important;
      }
    }
  </style>
</head>
<body>
  <div class="max-w-5xl mx-auto px-4 font-sans">
    <nav class="flex flex-col lg:flex-row items-center gap-4 py-4 border-b border-gray-300">
      <a href="/" class="flex-1 text-lg font-bold">Private Article Reader</a>
      <div class="flex gap-6">
        <a href="/#how-it-works" class="hover:underline">How it works ?</a>
        <a href="https://github.com/yourusername/private-article-reader" target="_blank" rel="noopener noreferrer" class="hover:underline">Source</a>
      </div>
    </nav>
    <main class="my-8">
      <div class="bg-white rounded-lg shadow p-6" style="background-color: var(--bg-color); color: var(--text-color);">
        <a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer" class="source-link flex items-center justify-center gap-2 bg-yellow-500 text-black text-center py-1 rounded font-bold underline mb-6">📄 Read at source</a>
        <h1 class="text-2xl md:text-3xl font-bold text-center my-4">${escapeHtml(article.title)}</h1>
        ${imageHtml}
        <div class="flex flex-wrap justify-center gap-6 text-sm text-gray-600 mt-4 mb-8" style="color: var(--text-color); opacity: 0.8;">
          <div class="flex items-center gap-1">👤 ${escapeHtml(author)}</div>
          <div class="flex items-center gap-1">📅 ${escapeHtml(publishedDate)}</div>
          <div class="flex items-center gap-1">⏱️ ${readingTime} min read</div>
        </div>

        <!-- Reader Controls -->
        <div class="reader-toolbar" id="reader-controls">
          <span class="group-label">Theme</span>
          <button data-theme="sepia" class="active">Sepia</button>
          <button data-theme="light">Light</button>
          <button data-theme="dark">Dark</button>

          <span class="group-label ml-2">Font</span>
          <button id="font-decrease" title="Decrease font size">A-</button>
          <button id="font-increase" title="Increase font size">A+</button>

          <span class="width-group">
            <span class="group-label ml-2">Width</span>
            <button data-width="narrow">Narrow</button>
            <button data-width="medium" class="active">Medium</button>
            <button data-width="wide">Wide</button>
          </span>
        </div>

        <div class="prose max-w-6xl mx-auto my-0 leading-relaxed" id="article-content">
          ${article.content}
        </div>
      </div>
    </main>
  </div>

  <script>
    (function() {
      const STORAGE_KEY = 'readerPreferences';

      const defaults = {
        theme: 'sepia',
        fontSize: 18,
        width: 'medium'
      };

      function loadPreferences() {
        try {
          const raw = localStorage.getItem(STORAGE_KEY);
          if (!raw) return { ...defaults };
          const parsed = JSON.parse(raw);
          return { ...defaults, ...parsed };
        } catch {
          return { ...defaults };
        }
      }

      function savePreferences(prefs) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
      }

      function applyTheme(theme) {
        const root = document.documentElement;
        const body = document.body;
        let bg, text;
        switch (theme) {
          case 'light':
            bg = '#ffffff';
            text = '#1a1a1a';
            body.classList.remove('theme-dark');
            break;
          case 'dark':
            bg = '#1e1e1e';
            text = '#d4d4d4';
            body.classList.add('theme-dark');
            break;
          default: // sepia
            bg = '#fbf4e8';
            text = '#5b4637';
            body.classList.remove('theme-dark');
        }
        root.style.setProperty('--bg-color', bg);
        root.style.setProperty('--text-color', text);

        document.querySelectorAll('[data-theme]').forEach(btn => {
          btn.classList.toggle('active', btn.dataset.theme === theme);
        });
      }

      function applyFontSize(size) {
        document.documentElement.style.setProperty('--font-size-base', size + 'px');
      }

      function applyWidth(width) {
        let maxWidth;
        switch (width) {
          case 'narrow': maxWidth = '50ch'; break;
          case 'wide': maxWidth = '90ch'; break;
          default: maxWidth = '65ch';
        }
        document.documentElement.style.setProperty('--prose-max-width', maxWidth);

        document.querySelectorAll('[data-width]').forEach(btn => {
          btn.classList.toggle('active', btn.dataset.width === width);
        });
      }

      const prefs = loadPreferences();
      applyTheme(prefs.theme);
      applyFontSize(prefs.fontSize);
      applyWidth(prefs.width);

      document.querySelectorAll('[data-theme]').forEach(btn => {
        btn.addEventListener('click', function() {
          const theme = this.dataset.theme;
          prefs.theme = theme;
          applyTheme(theme);
          savePreferences(prefs);
        });
      });

      document.getElementById('font-decrease').addEventListener('click', function() {
        prefs.fontSize = Math.max(12, prefs.fontSize - 2);
        applyFontSize(prefs.fontSize);
        savePreferences(prefs);
      });
      document.getElementById('font-increase').addEventListener('click', function() {
        prefs.fontSize = Math.min(32, prefs.fontSize + 2);
        applyFontSize(prefs.fontSize);
        savePreferences(prefs);
      });

      document.querySelectorAll('[data-width]').forEach(btn => {
        btn.addEventListener('click', function() {
          const width = this.dataset.width;
          prefs.width = width;
          applyWidth(width);
          savePreferences(prefs);
        });
      });
    })();
  </script>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  if (!str) return '';
  return str.replace(/[&<>"']/g, m => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[m] || m));
}

// ------------------------------
// Hono app
// ------------------------------
const app = new Hono<{ Bindings: Env }>();

app.use('*', async (c, next) => {
  await next();
  c.header('X-Frame-Options', 'DENY');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'no-referrer');
});

// Homepage with form and history
app.get('/', (c) => {
  const turnstileEnabled = c.env.TURNSTILE_ENABLED === 'true';
  const siteKey = c.env.TURNSTILE_SITE_KEY;
  if (turnstileEnabled && !siteKey) {
    return c.text('Turnstile enabled but TURNSTILE_SITE_KEY missing', 500);
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Private Article Reader</title>
  <script src="https://cdn.tailwindcss.com"></script>
  ${turnstileEnabled ? `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>` : ''}
</head>
<body class="bg-gray-100">
  <div class="max-w-5xl mx-auto px-4 font-sans">
    <nav class="flex flex-col lg:flex-row items-center gap-4 py-4 border-b border-gray-300">
      <a href="/" class="flex-1 text-lg font-bold">Private Article Reader</a>
      <div class="flex gap-6">
        <a href="/#how-it-works" class="hover:underline">How it works ?</a>
        <a href="https://github.com/yourusername/private-article-reader" target="_blank" rel="noopener noreferrer" class="hover:underline">Source</a>
      </div>
    </nav>
    <main class="my-8 space-y-8">
      <div class="bg-white rounded-lg shadow p-6">
        <form id="article-form" action="/article" method="POST" class="flex flex-col gap-4">
          <input id="article-url" type="url" name="url" required placeholder="Enter article URL (e.g. https://example.com/news)" class="border-2 rounded px-3 py-2 outline-none focus:border-gray-400">
          ${turnstileEnabled ? `<div class="cf-turnstile" data-sitekey="${siteKey}" data-theme="light"></div>` : ''}
          <button type="submit" class="bg-black text-white py-2 rounded hover:bg-gray-800 transition">Load Article</button>
        </form>
      </div>

      <div class="bg-white rounded-lg shadow p-6">
        <div class="flex items-center justify-between gap-4 mb-4">
          <h2 class="text-lg font-bold">History</h2>
          <button id="clear-history" type="button" class="px-4 py-2 text-white bg-red-600 rounded hover:bg-red-800">Clear History</button>
        </div>
        <ul id="history-list" class="max-h-56 overflow-y-auto divide-y divide-gray-200"></ul>
      </div>

      <div id="how-it-works" class="bg-white rounded-lg shadow p-6">
        <h2 class="text-lg font-bold mb-4">How it works ?</h2>
        <div class="space-y-3">
          <div class="flex items-center gap-2"><span class="bg-black text-white rounded-full w-6 h-6 flex items-center justify-center text-sm font-bold">1</span> <span>You enter URL. (News / Blog)</span></div>
          <div class="flex items-center gap-2"><span class="bg-black text-white rounded-full w-6 h-6 flex items-center justify-center text-sm font-bold">2</span> <span>Our bot fetches the page, strips trackers and scripts.</span></div>
          <div class="flex items-center gap-2"><span class="bg-black text-white rounded-full w-6 h-6 flex items-center justify-center text-sm font-bold">3</span> <span>We display it in an easy‑to‑read format.</span></div>
        </div>
      </div>
    </main>
  </div>

  <script>
    (() => {
      const STORAGE_KEY = 'linkHistory';
      const form = document.getElementById('article-form');
      const input = document.getElementById('article-url');
      const list = document.getElementById('history-list');
      const clearButton = document.getElementById('clear-history');

      if (!(form instanceof HTMLFormElement) || !(input instanceof HTMLInputElement) || !(list instanceof HTMLUListElement) || !(clearButton instanceof HTMLButtonElement)) {
        return;
      }

      function readHistory() {
        try {
          const value = localStorage.getItem(STORAGE_KEY);
          if (!value) return [];
          const parsed = JSON.parse(value);
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      }

      function writeHistory(items) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
      }

      function formatDate(iso) {
        try {
          return new Date(iso).toLocaleString('en-GB');
        } catch {
          return iso;
        }
      }

      function renderHistory() {
        const items = readHistory();
        list.innerHTML = '';

        if (!items.length) {
          const empty = document.createElement('li');
          empty.className = 'py-3 text-sm text-gray-500';
          empty.textContent = 'No history yet.';
          list.appendChild(empty);
          return;
        }

        items.slice(0, 20).forEach((entry) => {
          if (!entry || typeof entry.link !== 'string' || typeof entry.date !== 'string') return;

          const li = document.createElement('li');
          li.className = 'py-3 flex items-start justify-between gap-4';

          const linkButton = document.createElement('button');
          linkButton.type = 'button';
          linkButton.className = 'text-left text-blue-600 hover:underline break-all';
          linkButton.textContent = entry.link;
          linkButton.addEventListener('click', () => {
            input.value = entry.link;
            input.focus();
          });

          const date = document.createElement('span');
          date.className = 'shrink-0 text-sm text-gray-500';
          date.textContent = formatDate(entry.date);

          li.appendChild(linkButton);
          li.appendChild(date);
          list.appendChild(li);
        });
      }

      form.addEventListener('submit', () => {
        const url = input.value.trim();
        if (!url) return;

        const next = { link: url, date: new Date().toISOString() };
        const current = readHistory().filter((entry) => entry && entry.link !== url);
        current.unshift(next);
        writeHistory(current.slice(0, 100));
        renderHistory();
      });

      clearButton.addEventListener('click', () => {
        localStorage.removeItem(STORAGE_KEY);
        renderHistory();
      });

      renderHistory();
    })();
  </script>
</body>
</html>`;
  return c.html(html);
});

// Direct article view (unchanged)
app.post('/article', async (c) => {
  const body = await c.req.parseBody();
  const urlParam = typeof body.url === 'string' ? body.url : null;
  if (!urlParam) {
    return c.redirect('/');
  }

  let validUrl: string;
  try {
    validUrl = validateUrl(urlParam).href;
  } catch {
    return c.text('Invalid URL. Please provide a valid http:// or https:// address', 400);
  }

  const turnstileEnabled = c.env.TURNSTILE_ENABLED === 'true';
  if (turnstileEnabled) {
    if (!c.env.TURNSTILE_SECRET_KEY) {
      return c.text('Turnstile enabled but TURNSTILE_SECRET_KEY missing', 500);
    }

    const turnstileToken =
      typeof body['cf-turnstile-response'] === 'string'
        ? body['cf-turnstile-response']
        : typeof body.turnstileToken === 'string'
          ? body.turnstileToken
          : undefined;

    if (!turnstileToken) {
      return c.text('Turnstile token missing', 400);
    }

    const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || '';
    const ok = await verifyTurnstile(turnstileToken, ip, c.env.TURNSTILE_SECRET_KEY);
    if (!ok) {
      return c.text('CAPTCHA verification failed', 403);
    }
  }

  // Check cache
  const cached = await getCachedArticle(validUrl, c.env);
  if (cached) {
    const { fetchedAt, ...data } = cached;
    return c.html(renderArticlePage(data, validUrl));
  }

  try {
    const article = await fetchAndParseArticle(validUrl, c.env);
    await setCachedArticle(validUrl, article, c.env);
    return c.html(renderArticlePage(article, validUrl));
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.message : 'Extraction failed';
    return c.text(`Error: ${message}`, 500);
  }
});

// API endpoint (kept for potential client-side use, but not used by the homepage)
app.post('/api/extract', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body.url !== 'string') return c.text('Missing "url" field', 400);

  const { url, turnstileToken } = body;

  let validUrl: string;
  try {
    validUrl = validateUrl(url).href;
  } catch {
    return c.text('Invalid URL', 400);
  }

  const turnstileEnabled = c.env.TURNSTILE_ENABLED === 'true';
  if (turnstileEnabled) {
    if (!c.env.TURNSTILE_SECRET_KEY) {
      return c.text('Turnstile enabled but TURNSTILE_SECRET_KEY missing', 500);
    }

    if (!turnstileToken) return c.text('Turnstile token missing', 400);
    const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || '';
    const ok = await verifyTurnstile(turnstileToken, ip, c.env.TURNSTILE_SECRET_KEY);
    if (!ok) return c.text('CAPTCHA verification failed', 403);
  }

  const cached = await getCachedArticle(validUrl, c.env);
  if (cached) {
    const { fetchedAt, ...data } = cached;
    return c.json(data);
  }

  try {
    const article = await fetchAndParseArticle(validUrl, c.env);
    await setCachedArticle(validUrl, article, c.env);
    return c.json(article);
  } catch (err) {
    console.error(err);
    return c.text(err instanceof Error ? err.message : 'Extraction failed', 500);
  }
});

export default app;
