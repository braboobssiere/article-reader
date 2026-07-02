import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import sanitizeHtml from 'sanitize-html';
import desktopUserAgents from 'top-user-agents/desktop';
import { brotliCompress, brotliDecompress } from 'zlib';
import { promisify } from 'util';

const compress = promisify(brotliCompress);
const decompress = promisify(brotliDecompress);

export interface ArticleData {
  title: string;
  content: string;
  author: string | null;
  published: string | null;
}

// ── Cache (in‑memory + Cloudflare KV) ──────────────────────────────
const memoryCache = new Map<string, { data: Buffer; expires: number }>();
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

function kvUrl(key: string): string {
  return `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_NAMESPACE_ID}/values/${encodeURIComponent(key)}`;
}

async function compressData(data: ArticleData): Promise<Buffer> {
  return await compress(JSON.stringify(data));
}

async function decompressData(buffer: Buffer): Promise<ArticleData> {
  const json = await decompress(buffer);
  return JSON.parse(json.toString('utf-8'));
}

async function getFromCloudflareKV(key: string): Promise<ArticleData | null> {
  if (!CF_KV_ENABLED) return null;
  try {
    const res = await fetch(kvUrl(key), {
      headers: { Authorization: `Bearer ${CF_API_TOKEN}` },
    });
    if (!res.ok) {
      if (res.status === 404) return null;
      return null;
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    try {
      return await decompressData(buffer);
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

async function setToCloudflareKV(key: string, data: ArticleData): Promise<void> {
  if (!CF_KV_ENABLED) return;
  try {
    const url = kvUrl(key) + `?expiration_ttl=${CF_KV_TTL}`;
    await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${CF_API_TOKEN}`,
        'Content-Type': 'application/octet-stream',
      },
      body: new Uint8Array(await compressData(data)),
    });
  } catch (err) {
    console.warn('[Cloudflare KV] PUT error:', err);
  }
}

export async function getCached(url: string): Promise<ArticleData | null> {
  if (CF_KV_ENABLED) {
    const cfData = await getFromCloudflareKV(url);
    if (cfData) return cfData;
  }
  const entry = memoryCache.get(url);
  if (entry && entry.expires > Date.now()) {
    return await decompressData(entry.data);
  }
  memoryCache.delete(url);
  return null;
}

export async function setCached(url: string, data: ArticleData): Promise<void> {
  if (CF_KV_ENABLED) {
    setToCloudflareKV(url, data).catch(err =>
      console.warn('[Cloudflare KV] background set error:', err)
    );
  }
  const compressed = await compressData(data);
  memoryCache.set(url, { data: compressed, expires: Date.now() + MEMORY_TTL_MS });
}

// ── Fetch & parse helpers ──────────────────────────────────────────

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function selectUserAgent(): string {
  const ua = desktopUserAgents[Math.floor(Math.random() * desktopUserAgents.length)];
  return ua ?? DEFAULT_UA;
}

async function fetchHtml(url: string, timeoutMs = 8000): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': selectUserAgent() },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Request timeout');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ── Parse article from HTML using Readability ─────────────────────

async function parseArticleFromHtml(html: string, url: string): Promise<ArticleData> {
  const { document } = parseHTML(html, { baseURI: url });
  const reader = new Readability(document);
  const result = reader.parse();
  if (!result || !result.content || result.content.trim().length < 50) {
    throw new Error('Could not extract article content');
  }

  const sanitizedContent = sanitizeHtml(result.content, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img']),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      img: ['src', 'alt', 'width', 'height', 'srcset'],
    },
  });

  return {
    title: result.title || 'Untitled',
    content: sanitizedContent,
    author: result.byline || null,
    published: result.publishedTime || null,
  };
}

// ── Main fetch function (direct fetch) ─────────────────────────────

export async function fetchAndParseArticle(url: string): Promise<ArticleData> {
  try {
    const html = await fetchHtml(url);
    const article = await parseArticleFromHtml(html, url);
    if (article.content.length < 50) throw new Error('Content too short');
    return article;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Direct fetch failed: ${message}`);
  }
}
