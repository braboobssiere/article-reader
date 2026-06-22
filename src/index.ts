import { Hono } from 'hono';
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';

interface Env {
  TURNSTILE_ENABLED?: string;
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

const memoryCache = new Map<string, { data: CachedArticle; expires: number }>();
const CACHE_TTL_SECONDS = 3600;

function computeReadingTime(html: string): number {
  const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const wordCount = text.split(/\s+/).length;
  return Math.ceil((wordCount / 200) * 60);
}

function sanitizeHtml(html: string): string {
  let sanitized = html
    .replace(/<(script|iframe|object|embed)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '')
    .replace(/\s+href\s*=\s*["']\s*javascript:[^"']*["']/gi, '')
    .replace(/\s+srcdoc\s*=\s*["'][^"']*["']/gi, '');
  return sanitized;
}

// Fallback extraction when Readability fails
function fallbackExtract(html: string): { title: string; content: string } {
  const { document } = parseHTML(`<body>${html}</body>`);
  
  // Try common article selectors
  const selectors = ['article', '[role="article"]', '.post-content', '.entry-content', '.article-content', '.content'];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && el.innerHTML.trim().length > 100) {
      return {
        title: document.querySelector('title')?.textContent || 'Untitled',
        content: el.innerHTML,
      };
    }
  }
  
  // Fallback: use body but remove common non-content elements
  const body = document.body;
  const toRemove = body.querySelectorAll('nav, header, footer, aside, .sidebar, .advertisement, .ads');
  toRemove.forEach(el => el.remove());
  
  return {
    title: document.querySelector('title')?.textContent || 'Untitled',
    content: body.innerHTML,
  };
}

function extractImageFromDocument(doc: Document, articleContent?: string | null): string | null {
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
  if (articleContent) {
    const { document: contentDoc } = parseHTML(articleContent);
    const firstImg = contentDoc.querySelector('img');
    if (firstImg?.src) return firstImg.src;
  }
  return null;
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

    // Extract metadata
    let author: string | null = null;
    let published: string | null = null;

    const authorMeta = document.querySelector('meta[name="author"]')?.getAttribute('content') ||
      document.querySelector('meta[property="article:author"]')?.getAttribute('content');
    if (authorMeta) author = authorMeta;

    const dateMeta = document.querySelector('meta[property="article:published_time"]')?.getAttribute('content') ||
      document.querySelector('meta[name="publishdate"]')?.getAttribute('content');
    if (dateMeta) published = dateMeta;

    // Try Readability first
    const reader = new Readability(document);
    let parsed = reader.parse();
    let content = parsed?.content || '';

    // If Readability failed, use fallback
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

    const image = extractImageFromDocument(document, parsed?.content || content);
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
  const formData = new FormData();
  formData.append('secret', secretKey);
  formData.append('response', token);
  if (ip) formData.append('remoteip', ip);
  const result = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: formData,
  });
  const outcome = await result.json() as any;
  return outcome.success === true;
}

// ------------------------------
// Hono app
// ------------------------------
const app = new Hono<{ Bindings: Env }>();

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
  <style>
    .loader { display: inline-block; width: 40px; height: 40px; border: 3px solid #f3f3f3; border-top: 3px solid #000; border-radius: 50%; animation: spin 1s linear infinite; margin-right: 8px; }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
  </style>
</head>
<body class="bg-gray-100">
  <div class="max-w-5xl mx-auto px-4 font-sans">
    <nav class="flex flex-col lg:flex-row items-center gap-4 py-4 border-b border-gray-300">
      <a href="/" class="flex-1 text-lg font-bold">Private Article Reader</a>
      <div class="flex gap-6">
        <a href="/#how-it-works" class="hover:underline">How it works ?</a>
        <a href="https://github.com/yourusername/private-article-reader" target="_blank" class="hover:underline">Source</a>
      </div>
    </nav>
    <main class="my-8">
      <div class="bg-white rounded-lg shadow p-6 mb-8">
        <form id="article-form" class="flex flex-col gap-4">
          <input type="url" id="url-input" required placeholder="Enter article URL (e.g. https://example.com/news)" class="border-2 rounded px-3 py-2 outline-none focus:border-gray-400">
          ${turnstileEnabled ? `<div class="cf-turnstile" data-sitekey="${siteKey}" data-theme="light"></div>` : ''}
          <button type="submit" id="submit-btn" class="bg-black text-white py-2 rounded hover:bg-gray-800 transition">Load Article</button>
        </form>
      </div>
      <div id="how-it-works" class="bg-white rounded-lg shadow p-6">
        <h2 class="text-lg font-bold mb-4">How it works ?</h2>
        <div class="space-y-3">
          <div class="flex items-center gap-2"><span class="bg-black text-white rounded-full w-6 h-6 flex items-center justify-center text-sm font-bold">1</span> <span>You enter URL. (News / Blog)</span></div>
          <div class="flex items-center gap-2"><span class="bg-black text-white rounded-full w-6 h-6 flex items-center justify-center text-sm font-bold">2</span> <span>Our bot fetches the page, strips trackers and scripts.</span></div>
          <div class="flex items-center gap-2"><span class="bg-black text-white rounded-full w-6 h-6 flex items-center justify-center text-sm font-bold">3</span> <span>We display it in an easy‑to‑read format.</span></div>
        </div>
      </div>
      <div id="result-area" class="mt-8 hidden"></div>
    </main>
  </div>
  <script>
    const form = document.getElementById('article-form');
    const urlInput = document.getElementById('url-input');
    const submitBtn = document.getElementById('submit-btn');
    const resultArea = document.getElementById('result-area');
    const turnstileEnabled = ${turnstileEnabled};

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const url = urlInput.value.trim();
      if (!url) return;

      let turnstileToken = null;
      if (turnstileEnabled) {
        turnstileToken = document.querySelector('[name="cf-turnstile-response"]')?.value;
        if (!turnstileToken) {
          alert('Please complete the CAPTCHA.');
          return;
        }
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Loading ...';
      resultArea.innerHTML = '<div class="flex justify-center items-center py-12"><div class="loader"></div><span class="ml-2">Fetching article...</span></div>';
      resultArea.classList.remove('hidden');

      try {
        const res = await fetch('/api/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, turnstileToken })
        });
        if (!res.ok) {
          const errText = await res.text();
          throw new Error(errText || 'Failed to load article');
        }
        const article = await res.json();
        renderArticle(article);
        if (turnstileEnabled) turnstile.reset();
      } catch (err) {
        resultArea.innerHTML = \`<div class="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 rounded">⚠️ \${err.message}</div>\`;
        if (turnstileEnabled) turnstile.reset();
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Load Article';
      }
    });

    function renderArticle(article) {
      const readingTime = Math.round(article.ttr / 60);
      const publishedDate = article.published ? new Date(article.published).toLocaleDateString() : 'Publishing time not found';
      const author = article.author || 'No author found';
      const imageHtml = article.image && !article.content.includes(article.image)
        ? \`<img src="\${article.image}" alt="\${article.title}" class="w-full mx-auto my-5 rounded shadow" />\`
        : '';

      // log content length for debugging
      console.log('Content length:', article.content.length);

      resultArea.innerHTML = \`
        <div class="bg-white rounded-lg shadow p-6">
          <a href="\${urlInput.value}" target="_blank" class="flex items-center justify-center gap-2 bg-yellow-500 text-center py-1 rounded font-bold underline mb-6">📄 Read at source</a>
          <h1 class="text-2xl md:text-3xl font-bold text-center my-4">\${escapeHtml(article.title)}</h1>
          \${imageHtml}
          <div class="flex flex-wrap justify-center gap-6 text-sm text-gray-600 mt-4 mb-8">
            <div class="flex items-center gap-1">👤 \${escapeHtml(author)}</div>
            <div class="flex items-center gap-1">📅 \${escapeHtml(publishedDate)}</div>
            <div class="flex items-center gap-1">⏱️ \${readingTime} min read</div>
          </div>
          <div class="prose max-w-6xl mx-auto my-0 leading-relaxed">\${article.content}</div>
        </div>
      \`;
      resultArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function escapeHtml(str) {
      if (!str) return '';
      return str.replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m] || m));
    }
  </script>
</body>
</html>`;
  return c.html(html);
});

app.post('/api/extract', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || !body.url) return c.text('Missing "url" field', 400);

  const { url, turnstileToken } = body;
  try {
    new URL(url);
  } catch {
    return c.text('Invalid URL', 400);
  }

  const turnstileEnabled = c.env.TURNSTILE_ENABLED === 'true';
  if (turnstileEnabled) {
    if (!turnstileToken) return c.text('Turnstile token missing', 400);
    const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || '';
    const ok = await verifyTurnstile(turnstileToken, ip, c.env.TURNSTILE_SECRET_KEY!);
    if (!ok) return c.text('CAPTCHA verification failed', 403);
  }

  const cached = await getCachedArticle(url, c.env);
  if (cached) {
    const { fetchedAt, ...data } = cached;
    return c.json(data);
  }

  try {
    const article = await fetchAndParseArticle(url, c.env);
    await setCachedArticle(url, article, c.env);
    return c.json(article);
  } catch (err) {
    console.error(err);
    return c.text(err instanceof Error ? err.message : 'Extraction failed', 500);
  }
});

export default app;
