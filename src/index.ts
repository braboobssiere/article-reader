import { Hono } from 'hono';
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';

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

function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();

  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === 'metadata.google.internal' ||
    host === 'metadata.azure.internal' ||
    host === '169.254.169.254' ||
    host === '169.254.169.253' ||
    host === '100.100.100.200' ||
    host === '100.100.100.100'
  ) {
    return true;
  }

  if (host.includes(':')) {
    const normalized = host.replace(/^\[|\]$/g, '');
    if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') return true;
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
    if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) return true;
    return false;
  }

  const ipv4 = host.match(/^(\d{1,3}\.){3}\d{1,3}$/);
  if (ipv4) {
    const octets = host.split('.').map(Number);
    if (octets.some(n => Number.isNaN(n) || n < 0 || n > 255)) return true;
    const [a, b] = octets;

    if (a === 0 || a === 10 || a === 127 || a === 255) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    return false;
  }

  if (host.endsWith('.local') || host.endsWith('.internal') || host.includes('metadata')) return true;

  return false;
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
    .prose { max-width: 65ch; margin: 0 auto; line-height: 1.8; }
    .prose p { margin-bottom: 1.2em; }
    .prose img { margin: 2em auto; border-radius: 0.5rem; }
    .prose h2, .prose h3 { font-weight: 600; margin-top: 1.5em; margin-bottom: 0.5em; }
  </style>
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
    <main class="my-8">
      <div class="bg-white rounded-lg shadow p-6">
        <a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer" class="flex items-center justify-center gap-2 bg-yellow-500 text-center py-1 rounded font-bold underline mb-6">📄 Read at source</a>
        <h1 class="text-2xl md:text-3xl font-bold text-center my-4">${escapeHtml(article.title)}</h1>
        ${imageHtml}
        <div class="flex flex-wrap justify-center gap-6 text-sm text-gray-600 mt-4 mb-8">
          <div class="flex items-center gap-1">👤 ${escapeHtml(author)}</div>
          <div class="flex items-center gap-1">📅 ${escapeHtml(publishedDate)}</div>
          <div class="flex items-center gap-1">⏱️ ${readingTime} min read</div>
        </div>
        <div class="prose max-w-6xl mx-auto my-0 leading-relaxed">${article.content}</div>
      </div>
    </main>
  </div>
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

// Homepage with form and history (from second file)
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

// Direct article view (unchanged from original index.ts)
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
