import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import sanitizeHtml from 'sanitize-html';

export interface ArticleData {
  title: string;
  content: string;
  author: string | null;
  published: string | null;
  image: string | null;
  ttr: number;
}

const cache = new Map<string, { data: ArticleData; expires: number }>();
const CACHE_TTL_MS = 3_600_000;

export function getCached(url: string): ArticleData | null {
  const entry = cache.get(url);
  if (entry && entry.expires > Date.now()) return entry.data;
  cache.delete(url);
  return null;
}

export function setCached(url: string, data: ArticleData): void {
  cache.set(url, { data, expires: Date.now() + CACHE_TTL_MS });
}

function computeReadingTime(html: string): number {
  const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return Math.ceil((text.split(/\s+/).length / 200) * 60);
}

function extractImage(rawHtml: string, doc: Document): string | null {
  const metaSelectors = [
    'meta[property="og:image"]',
    'meta[name="twitter:image"]',
    'meta[property="og:image:secure_url"]',
  ];
  for (const sel of metaSelectors) {
    const content = doc.querySelector(sel)?.getAttribute('content');
    if (content?.startsWith('http')) return content;
  }
  const m =
    rawHtml.match(/<img\b[^>]*\bsrc\s*=\s*(["'])(https?:\/\/[^"'\s>]+)\1/i) ||
    rawHtml.match(/<img\b[^>]*\bsrc\s*=\s*(https?:\/\/[^\s>]+)/i);
  return m?.[2] ?? m?.[1] ?? null;
}

export async function fetchAndParseArticle(url: string): Promise<ArticleData> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PrivateArticleReader/1.0)' },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const rawHtml = await response.text();
    const { document } = parseHTML(rawHtml);

    const author =
      document.querySelector('meta[name="author"]')?.getAttribute('content') ||
      document.querySelector('meta[property="article:author"]')?.getAttribute('content') ||
      null;

    const published =
      document.querySelector('meta[property="article:published_time"]')?.getAttribute('content') ||
      document.querySelector('meta[name="publishdate"]')?.getAttribute('content') ||
      null;

    const image = extractImage(rawHtml, document);

    const reader = new Readability(document);
    const parsed = reader.parse();

    if (!parsed?.content || parsed.content.trim().length < 50) {
      throw new Error('Could not extract article content');
    }

    const content = sanitizeHtml(parsed.content);

    return {
      title: parsed.title || 'Untitled',
      content,
      author: author || parsed.byline || null,
      published: published || null,
      image,
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
