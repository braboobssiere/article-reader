import { parseHTML } from 'linkedom';
import { Defuddle } from 'defuddle/node';
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
  image: string | null;
}

// ── In‑memory cache ──────────────────────────────────────────────────────
const memoryCache = new Map<string, { data: Buffer; expires: number }>();
const MEMORY_TTL_MS = 3_600_000;

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of memoryCache) {
    if (entry.expires <= now) memoryCache.delete(key);
  }
}, MEMORY_TTL_MS).unref();

// ── Cloudflare KV config ────────────────────────────────────────────────
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

// ── Compression helpers ──────────────────────────────────────────────────
async function compressData(data: ArticleData): Promise<Buffer> {
  const json = JSON.stringify(data);
  return await compress(json);
}

async function decompressData(buffer: Buffer): Promise<ArticleData> {
  const json = await decompress(buffer);
  return JSON.parse(json.toString('utf-8'));
}

// ── Cloudflare KV functions ─────────────────────────────────────────────
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
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    try {
      return await decompressData(buffer);
    } catch (err) {
      console.warn(`[Cloudflare KV] Decompression failed for key ${key}, treating as cache miss:`, err);
      return null;
    }
  } catch (err) {
    console.warn('[Cloudflare KV] GET error, treating as cache miss:', err);
    return null;
  }
}

async function setToCloudflareKV(key: string, data: ArticleData): Promise<void> {
  if (!CF_KV_ENABLED) return;
  try {
    const url = kvUrl(key) + `?expiration_ttl=${CF_KV_TTL}`;
    const compressed = await compressData(data);
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${CF_API_TOKEN}`,
        'Content-Type': 'application/octet-stream',
      },
      body: compressed,
    });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
  } catch (err) {
    console.warn('[Cloudflare KV] PUT error, caching skipped:', err);
  }
}

// ── Public cache interface ──────────────────────────────────────────────
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

// ── Article fetching ─────────────────────────────────────────────────────
const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function selectUserAgent(): string {
  const ua = desktopUserAgents[Math.floor(Math.random() * desktopUserAgents.length)];
  return ua ?? DEFAULT_UA;
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
    const { document } = parseHTML(rawHtml);

    const result = await Promise.race([
      Defuddle(document, url, { markdown: false, debug: false }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Defuddle parse timeout')), 5000)
      ),
    ]);

    const title = result.title || 'Untitled';
    const content = result.content || '';

    if (content.trim().length < 50) {
      throw new Error('Could not extract article content');
    }

    const sanitizedContent = sanitizeHtml(content, {
      allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img']),
      allowedAttributes: {
        ...sanitizeHtml.defaults.allowedAttributes,
        img: ['src', 'alt', 'width', 'height'],
      },
    });

    return {
      title,
      content: sanitizedContent,
      author: result.author || null,
      published: result.published || null,
      image: result.image || null,
    };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Request timeout – the website took too long to respond');
    }
    throw err;
  }
}
