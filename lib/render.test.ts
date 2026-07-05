import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { renderArticlePage, renderErrorPage } from './render';
import type { ArticleData } from './article';

describe('renderArticlePage', () => {
  it('strips <script> tags to prevent XSS', () => {
    const article: ArticleData = {
      title: 'Test',
      content: '<p>Hello</p><script>alert("xss")</script><img src="x" />',
      author: 'Author',
      published: '2025-01-01',
    };
    const html = renderArticlePage(article, 'https://example.com');
    assert.ok(!html.includes('<script>'), 'Script tag should be removed');
    assert.ok(html.includes('<p>Hello</p>'), 'Safe content should remain');
    assert.ok(html.includes('<img src="x"'), 'Img tags should be allowed');
  });

  it('includes the title and author in the rendered page', () => {
    const article: ArticleData = {
      title: 'My Article',
      content: '<p>Content</p>',
      author: 'John Doe',
      published: '2025-06-29',
    };
    const html = renderArticlePage(article, 'https://source.com');
    assert.ok(html.includes('My Article'));
    assert.ok(html.includes('John Doe'));
    assert.ok(html.includes('29/06/2025')); // date format depends on locale
  });

  it('adds a nonce to the reader controls script when provided', () => {
    const article: ArticleData = {
      title: 'Nonce Test',
      content: '<p>Content</p>',
      author: null,
      published: null,
    };
    const html = renderArticlePage(article, 'https://source.com', 'abc123');
    assert.ok(
      html.includes('<script src="/reader-controls.js" nonce="abc123"></script>'),
      'reader controls script should carry the nonce',
    );
  });
});

describe('renderErrorPage', () => {
  it('displays the error message', () => {
    const html = renderErrorPage('Something went wrong');
    assert.ok(html.includes('Something went wrong'));
    assert.ok(html.includes('Back to home'));
  });
});
