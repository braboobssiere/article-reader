import { strict as assert } from 'node:assert';
import { describe, it, mock, before, after } from 'node:test';
import { getCached, setCached, fetchAndParseArticle } from './article';
import type { ArticleData } from './article';

describe('caching', () => {
  const testUrl = 'https://example.com/article';
  const testData: ArticleData = {
    title: 'Test Article',
    content: '<p>Content</p>',
    author: 'Tester',
    published: '2025-01-01',
    image: null,
  };

  // Reset environment for these tests
  before(() => {
    process.env.CLOUDFLARE_KV_ENABLED = 'false'; // use memory cache only
  });

  it('stores and retrieves from memory cache', async () => {
    await setCached(testUrl, testData);
    const cached = await getCached(testUrl);
    assert.deepEqual(cached, testData);
  });

  it('returns null for uncached URL', async () => {
    const cached = await getCached('https://unknown.com');
    assert.equal(cached, null);
  });
});

describe('fetchAndParseArticle', () => {
  const testHtml = `
    <html>
      <head><title>Test Page</title></head>
      <body>
        <article>
          <h1>Test Title</h1>
          <p>This is the article content. It is more than 50 characters so it passes the check.</p>
          <img src="image.jpg" />
        </article>
        <meta name="author" content="Jane Doe" />
        <meta property="article:published_time" content="2025-06-29" />
        <meta property="og:image" content="https://example.com/og.jpg" />
      </body>
    </html>
  `;

  it('extracts article data from HTML', async () => {
    // Mock fetch
    const originalFetch = global.fetch;
    global.fetch = mock.fn(async () => {
      return new Response(testHtml, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    });

    const result = await fetchAndParseArticle('https://example.com/test');
    assert.equal(result.title, 'Test Title');
    assert.ok(result.content.includes('This is the article content'));
    assert.equal(result.author, 'Jane Doe');
    assert.equal(result.published, '2025-06-29');
    assert.equal(result.image, 'https://example.com/og.jpg');

    global.fetch = originalFetch;
  });

  it('throws when content is too short', async () => {
    const shortHtml = `<html><body><p>Short</p></body></html>`;
    global.fetch = mock.fn(async () => new Response(shortHtml, { status: 200 }));

    await assert.rejects(
      fetchAndParseArticle('https://example.com/short'),
      /Could not extract article content/
    );

    (global.fetch as any).mock.restore();
  });

  it('times out the fetch after 10 seconds', async () => {
    // Mock fetch that never resolves
    global.fetch = mock.fn(() => new Promise(() => {}));
    const start = Date.now();
    await assert.rejects(
      fetchAndParseArticle('https://example.com/slow'),
      /Request timeout/
    );
    const elapsed = Date.now() - start;
    // Allow some margin
    assert.ok(elapsed >= 9000 && elapsed < 12000);
    (global.fetch as any).mock.restore();
  });
});
