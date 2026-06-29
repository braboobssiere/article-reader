import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import sanitizeHtml from 'sanitize-html';
import desktopUserAgents from 'top-user-agents/desktop';

export interface ArticleData {
  title: string;
  content: string;
  author: string | null;
  published: string | null;
  image: string | null;
}

// Short-lived in-memory cache – useful mainly for burst traffic on the same instance.
// In Vercel serverless, instances are ephemeral and spin down quickly.
const memoryCache = new Map<string, { data: ArticleData; expires: number }>();
const MEMORY_TTL_MS = 3_600_000;

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of memoryCache) {
    if (entry.expires <= now) memoryCache.delete(key);
  }
}, MEMORY_TTL_MS).unref();

const CF_KV_ENABLED = process.env.CLOUDFLARE_KV_ENABLED === 'true';
const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || '';
const CF_NAMESPACE_ID = process.env.CLOUDFLARE_KV_NAMESPACE_ID || '';
const CF_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || '';

const CF_KV_TTL_RAW = parseInt(process.env.CLOUDFLARE_KV_TTL ?? '', 10);
if (process.env.CLOUDFLARE_KV_TTL && isNaN(CF_KV_TTL_RAW)) {
  console.warn('[config] CLOUDFLARE_KV_TTL is not a valid integer, using default of 86400');
}
const CF_KV_TTL = Math.max(3600, !isNaN(CF_KV_TTL_RAW) ? CF_KV_TTL_RAW : 86400);
if (!isNaN(CF_KV_TTL_RAW) && CF_KV_TTL_RAW < 3600) {
  console.warn('[config] CLOUDFLARE_KV_TTL is below 3600, clamped to 3600');
}

function kvUrl(key: string): string {
  return `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_NAMESPACE_ID}/values/${encodeURIComponent(key)}`;
}

async function getFromCloudflareKV(key: string): Promise<ArticleData | null> {
  if (!CF_KV_ENABLED) return null;
  try {
    const res = await fetch(kvUrl(key), {
      headers: { Authorization: `Bearer ${CF_API_TOKEN}` },
    });
    if (!res.ok) {
      if (res.status === 404) return null;
      const text = await res.text();
      console.warn(`[Cloudflare KV] GET failed (${res.status}): ${text.slice(0, 200)}`);
      return null;
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
    const url = kvUrl(key) + `?expiration_ttl=${CF_KV_TTL}`;
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${CF_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
  } catch (err) {
    console.warn('[Cloudflare KV] PUT error, caching skipped:', err);
  }
}

export async function getCached(url: string): Promise<ArticleData | null> {
  if (CF_KV_ENABLED) {
    const cfData = await getFromCloudflareKV(url);
    if (cfData) return cfData;
  }

  const entry = memoryCache.get(url);
  if (entry && entry.expires > Date.now()) return entry.data;
  memoryCache.delete(url);
  return null;
}

export async function setCached(url: string, data: ArticleData): Promise<void> {
  if (CF_KV_ENABLED) {
    setToCloudflareKV(url, data).catch(err =>
      console.warn('[Cloudflare KV] background set error:', err)
    );
  }
  memoryCache.set(url, { data, expires: Date.now() + MEMORY_TTL_MS });
}

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function selectUserAgent(): string {
  const ua = desktopUserAgents[Math.floor(Math.random() * desktopUserAgents.length)];
  return ua ?? DEFAULT_UA;
}

/**
 * Extract metadata from the DOM using multiple strategies:
 * - JSON‑LD (schema.org)
 * - Open Graph / Twitter / standard meta tags
 * - Fallback to <link rel="image_src">
 * Resolves relative image URLs against the base URL.
 */
function extractMetadata(doc: Document, baseUrl: string): {
  author: string | null;
  published: string | null;
  image: string | null;
} {
  // Helper to get meta content by name or property
  const meta = (selector: string) => {
    const el = doc.querySelector(selector);
    return el?.getAttribute('content')?.trim() || null;
  };

  // 1. Try JSON‑LD (schema.org)
  let jsonLdData: any = null;
  const scriptTags = doc.querySelectorAll('script[type="application/ld+json"]');
  for (const script of scriptTags) {
    try {
      const parsed = JSON.parse(script.textContent || '');
      // If it's an array, take the first item or find the relevant type
      let data = Array.isArray(parsed) ? parsed.find(item => item['@type']?.includes('Article')) || parsed[0] : parsed;
      if (data && (data['@type']?.includes('Article') || data['@type']?.includes('NewsArticle') || data['@type']?.includes('BlogPosting'))) {
        jsonLdData = data;
        break;
      }
    } catch (_) { /* ignore invalid JSON */ }
  }

  // Extract author from JSON‑LD
  let author: string | null = null;
  if (jsonLdData) {
    if (jsonLdData.author) {
      if (typeof jsonLdData.author === 'string') {
        author = jsonLdData.author;
      } else if (jsonLdData.author.name) {
        author = jsonLdData.author.name;
      } else if (Array.isArray(jsonLdData.author) && jsonLdData.author.length > 0) {
        author = jsonLdData.author[0].name || jsonLdData.author[0];
      }
    }
  }

  // Fallback to meta tags
  if (!author) {
    author =
      meta('meta[name="author"]') ||
      meta('meta[property="article:author"]') ||
      meta('meta[property="og:author"]') ||
      meta('meta[name="creator"]') ||
      meta('meta[property="og:article:author"]') ||
      null;
  }

  // Extract date published
  let published: string | null = null;
  if (jsonLdData) {
    published = jsonLdData.datePublished || jsonLdData.dateModified || null;
  }
  if (!published) {
    published =
      meta('meta[property="article:published_time"]') ||
      meta('meta[property="og:published_time"]') ||
      meta('meta[name="date"]') ||
      meta('meta[name="publish-date"]') ||
      meta('meta[name="pubdate"]') ||
      meta('meta[property="og:article:published_time"]') ||
      null;
  }

  // Extract image
  let image: string | null = null;
  if (jsonLdData) {
    image = jsonLdData.image || jsonLdData.thumbnailUrl || null;
    if (image && typeof image === 'object') {
      image = image.url || image.contentUrl || null;
    }
    if (Array.isArray(image) && image.length > 0) {
      image = image[0];
      if (typeof image === 'object') image = image.url || image.contentUrl || null;
    }
  }
  if (!image) {
    image =
      meta('meta[property="og:image:secure_url"]') ||
      meta('meta[property="og:image"]') ||
      meta('meta[property="twitter:image:src"]') ||
      meta('meta[name="twitter:image"]') ||
      meta('meta[property="og:image:url"]') ||
      null;
  }
  // Fallback to <link rel="image_src">
  if (!image) {
    const link = doc.querySelector('link[rel="image_src"]');
    if (link) image = link.getAttribute('href');
  }

  // Resolve relative image URL against the base URL
  if (image) {
    try {
      image = new URL(image, baseUrl).href;
    } catch (_) {
      // keep as is if invalid
    }
  }

  return { author, published, image };
}

export async function fetchAndParseArticle(url: string): Promise<ArticleData> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': selectUserAgent() },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const rawHtml = await response.text();

    // Parse HTML once with linkedom
    const { document } = parseHTML(rawHtml);

    // Extract metadata using the robust extractor, passing the base URL for image resolution
    const meta = extractMetadata(document, url);

    // Run Readability with a timeout to prevent hanging on pathological HTML
    const parsed = await Promise.race([
      Promise.resolve(new Readability(document).parse()),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Parse timeout')), 5000)),
    ]);

    if (!parsed?.content || parsed.content.trim().length < 50) {
      throw new Error('Could not extract article content');
    }

    // Sanitize with a timeout as well
    const content = await Promise.race([
      Promise.resolve(sanitizeHtml(parsed.content, {
        allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img']),
        allowedAttributes: {
          ...sanitizeHtml.defaults.allowedAttributes,
          img: ['src', 'alt', 'width', 'height'],
        },
      })),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Sanitize timeout')), 5000)),
    ]);

    return {
      title: parsed.title || 'Untitled',
      content,
      author: meta.author || parsed.byline || null,
      published: meta.published || null,
      image: meta.image || null,
    };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Request timeout – the website took too long to respond');
    }
    throw err;
  }
}
