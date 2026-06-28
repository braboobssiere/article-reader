import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import sanitizeHtml from 'sanitize-html';
import metascraper from 'metascraper';
import metascraperAuthor from 'metascraper-author';
import metascraperImage from 'metascraper-image';
import metascraperDate from 'metascraper-date';

export interface ArticleData {
  title: string;
  content: string;
  author: string | null;
  published: string | null;
  image: string | null;
  ttr: number;
}

const scraper = metascraper([
  metascraperAuthor(),
  metascraperImage(),
  metascraperDate(),
]);

// ── In‑memory fallback cache ──────────────────────────────────────────
const memoryCache = new Map<string, { data: ArticleData; expires: number }>();
const MEMORY_TTL_MS = 3_600_000; // 1 hour

// ── Cloudflare KV configuration ────────────────────────────────────────
const CF_KV_ENABLED = process.env.CLOUDFLARE_KV_ENABLED === 'true';
const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || '';
const CF_NAMESPACE_ID = process.env.CLOUDFLARE_KV_NAMESPACE_ID || '';
const CF_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || '';

// ── Helper: build Cloudflare KV URL for a key ────────────────────────
function kvUrl(key: string): string {
  return `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_NAMESPACE_ID}/values/${encodeURIComponent(key)}`;
}

// ── Cloudflare KV operations ──────────────────────────────────────────
async function getFromCloudflareKV(key: string): Promise<ArticleData | null> {
  if (!CF_KV_ENABLED) return null;
  try {
    const res = await fetch(kvUrl(key), {
      headers: { Authorization: `Bearer ${CF_API_TOKEN}` },
    });
    if (!res.ok) {
      if (res.status === 404) return null;
      throw new Error(`Cloudflare KV GET failed: ${res.status}`);
    }
    const data = await res.json();
    return data as ArticleData;
  } catch (err) {
    console.warn('[Cloudflare KV] GET error, falling back to memory:', err);
    return null;
  }
}

async function setToCloudflareKV(key: string, data: ArticleData): Promise<void> {
  if (!CF_KV_ENABLED) return;
  try {
    const url = kvUrl(key) + '?expirationTtl=86400'; // 1 day
    await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${CF_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });
  } catch (err) {
    console.warn('[Cloudflare KV] PUT error, caching skipped:', err);
  }
}

// ── Public cache API (now async) ──────────────────────────────────────
export async function getCached(url: string): Promise<ArticleData | null> {
  // 1. Try Cloudflare KV first if enabled
  if (CF_KV_ENABLED) {
    const cfData = await getFromCloudflareKV(url);
    if (cfData) return cfData;
  }

  // 2. Fallback to in‑memory
  const entry = memoryCache.get(url);
  if (entry && entry.expires > Date.now()) return entry.data;
  memoryCache.delete(url);
  return null;
}

export async function setCached(url: string, data: ArticleData): Promise<void> {
  // 1. Store in Cloudflare KV if enabled (do not await – fire and forget)
  if (CF_KV_ENABLED) {
    // We await inside setToCloudflareKV but we can let it run in background
    // to not block the response. However, we must ensure errors are logged.
    setToCloudflareKV(url, data).catch(err =>
      console.warn('[Cloudflare KV] background set error:', err)
    );
  }

  // 2. Always store in memory as a quick fallback
  memoryCache.set(url, { data, expires: Date.now() + MEMORY_TTL_MS });
}

// ── fetch and parse (unchanged) ──────────────────────────────────────
function computeReadingTime(html: string): number {
  const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return Math.ceil((text.split(/\s+/).length / 200) * 60);
}

export async function fetchAndParseArticle(url: string, userAgent?: string): Promise<ArticleData> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': userAgent || 'Mozilla/5.0 (compatible; PrivateArticleReader/1.0)',
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const rawHtml = await response.text();

    const [meta, { document }] = await Promise.all([
      scraper({ html: rawHtml, url }),
      Promise.resolve(parseHTML(rawHtml)),
    ]);

    const reader = new Readability(document);
    const parsed = reader.parse();

    if (!parsed?.content || parsed.content.trim().length < 50) {
      throw new Error('Could not extract article content');
    }

    const content = sanitizeHtml(parsed.content, {
      allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img']),
      allowedAttributes: {
        ...sanitizeHtml.defaults.allowedAttributes,
        img: ['src', 'alt', 'width', 'height'],
      },
    });

    return {
      title: parsed.title || 'Untitled',
      content,
      author: meta.author || parsed.byline || null,
      published: meta.date || null,
      image: meta.image || null,
      ttr: computeReadingTime(content),
    };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Request timeout – the website took too long to respond');
    }
    throw err;
  }
}
