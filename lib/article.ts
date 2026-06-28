import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import sanitizeHtml from 'sanitize-html';
import metascraper from 'metascraper';
import metascraperAuthor from 'metascraper-author';
import metascraperImage from 'metascraper-image';

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
]);

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

    const published =
      document.querySelector('meta[property="article:published_time"]')?.getAttribute('content') ||
      document.querySelector('meta[name="publishdate"]')?.getAttribute('content') ||
      null;

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
      published,
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
