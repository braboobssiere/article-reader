import { Eta } from 'eta';
import type { ArticleData } from './article';

const eta = new Eta({
  cache: process.env.NODE_ENV === 'production',
});

const LAYOUT_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title><%= it.title %></title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    :root {
      --bg-color: #fbf4e8;
      --text-color: #5b4637;
      --prose-max-width: 65ch;
      --font-size-base: 18px;
    }
    body { background-color: var(--bg-color); color: var(--text-color); transition: background-color 0.2s, color 0.2s; }
    .prose { max-width: var(--prose-max-width); margin: 0 auto; line-height: 1.8; font-size: var(--font-size-base); }
    .prose p { margin-bottom: 1.2em; }
    .prose img { margin: 2em auto; border-radius: 0.5rem; }
    .prose h2, .prose h3 { font-weight: 600; margin-top: 1.5em; margin-bottom: 0.5em; }
    .prose a { color: LinkText; text-decoration: underline; }
    .prose a:hover { text-decoration: underline; }

    .reader-toolbar { display: flex; flex-wrap: wrap; gap: 0.5rem 1rem; align-items: center; justify-content: center; padding: 0.75rem 1rem; background: rgba(255,255,255,0.6); border-radius: 9999px; margin-bottom: 1.5rem; backdrop-filter: blur(4px); box-shadow: 0 2px 8px rgba(0,0,0,0.05); transition: background 0.2s; }
    .reader-toolbar button { background: transparent; border: 1px solid #ccc; border-radius: 9999px; padding: 0.25rem 0.75rem; font-size: 0.9rem; cursor: pointer; transition: background 0.15s, border-color 0.15s; color: inherit; }
    .reader-toolbar button:hover { background: rgba(0,0,0,0.08); }
    .reader-toolbar .active { background: #000; color: #fff; border-color: #000; }
    .reader-toolbar .active:hover { background: #333; }
    .reader-toolbar .group-label { font-size: 0.8rem; opacity: 0.7; margin-right: 0.2rem; }
    .reader-toolbar .width-group { display: inline-flex; align-items: center; gap: 0.5rem; }

    body.theme-dark .reader-toolbar { background: rgba(0,0,0,0.7); border-color: #444; }
    body.theme-dark .reader-toolbar button { border-color: #555; color: #ddd; }
    body.theme-dark .reader-toolbar button:hover { background: rgba(255,255,255,0.1); }
    body.theme-dark .reader-toolbar .active { background: #fff; color: #000; border-color: #fff; }
    body.theme-dark .reader-toolbar .active:hover { background: #ddd; }
    body.theme-dark nav { border-bottom-color: #444 !important; }
    body.theme-dark .source-link { background-color: #d97706 !important; color: #000 !important; }
    body.theme-dark .source-link:hover { background-color: #b45309 !important; }
    body.theme-dark .share-link { background-color: #374151 !important; color: #f9fafb !important; }
    body.theme-dark .share-link:hover { background-color: #4b5563 !important; }

    @media (max-width: 768px) {
      .max-w-5xl { max-width: 100% !important; padding-left: 0 !important; padding-right: 0 !important; }
      .bg-white.rounded-lg.shadow.p-6 { border-radius: 0 !important; box-shadow: none !important; padding: 0.5rem !important; }
      .reader-toolbar { border-radius: 0.5rem; flex-wrap: wrap; gap: 0.25rem 0.5rem; padding: 0.5rem; background: rgba(255,255,255,0.8); }
      body.theme-dark .reader-toolbar { background: rgba(0,0,0,0.8); }
      .reader-toolbar .group-label { font-size: 0.7rem; }
      .reader-toolbar button { font-size: 0.8rem; padding: 0.15rem 0.5rem; }
      .reader-toolbar .width-group { display: none !important; }
    }
  </style>
</head>
<body>
  <div class="max-w-5xl mx-auto px-4 font-sans">
    <nav class="flex flex-col lg:flex-row items-center gap-4 py-4 border-b border-gray-300">
      <a href="/" class="flex-1 text-lg font-bold">Private Article Reader</a>
    </nav>
    <main class="my-8">
      <div class="bg-white rounded-lg shadow p-6" style="background-color: var(--bg-color); color: var(--text-color);">
        <%~ it.body %>
      </div>
    </main>
  </div>
  <%~ it.scripts %>
</body>
</html>`;

const ARTICLE_TEMPLATE = `
<a href="<%= it.sourceUrl %>" target="_blank" rel="noopener noreferrer"
   class="source-link flex items-center justify-center gap-2 bg-yellow-500 text-black text-center py-1 rounded font-bold underline mb-6">
  📄 Read at source
</a>
<h1 class="text-2xl md:text-3xl font-bold text-center my-4"><%= it.article.title %></h1>

<% if (it.article.image && !it.article.content.includes(it.article.image)) { %>
  <img src="<%= it.article.image %>" alt="<%= it.article.title %>" class="w-full mx-auto my-5 rounded shadow" />
<% } %>

<div class="flex flex-wrap justify-center gap-6 text-sm mt-4 mb-8" style="opacity: 0.8;">
  <div class="flex items-center gap-1">👤 <%= it.article.author %></div>
  <div class="flex items-center gap-1">📅 <%= it.publishedDate %></div>
</div>

<div class="reader-toolbar" id="reader-controls">
  <span class="group-label">Theme</span>
  <button data-theme="sepia" class="active">Sepia</button>
  <button data-theme="light">Light</button>
  <button data-theme="dark">Dark</button>
  <span class="group-label ml-2">Font</span>
  <button id="font-decrease" title="Decrease font size">A-</button>
  <button id="font-increase" title="Increase font size">A+</button>
  <span class="width-group">
    <span class="group-label ml-2">Width</span>
    <button data-width="narrow">Narrow</button>
    <button data-width="medium" class="active">Medium</button>
    <button data-width="wide">Wide</button>
  </span>
</div>

<div class="prose mx-auto my-0 leading-relaxed" id="article-content">
  <%~ it.article.content %>
</div>

<div class="mt-8 pt-6 text-center text-sm" style="border-top: 1px solid rgba(0,0,0,0.1);">
  <p style="opacity: 0.6; margin-bottom: 0.75rem;">🔗 Share or bookmark this article</p>
  <button
    id="share-btn"
    data-share-url="<%= it.shareUrl %>"
    class="share-link inline-block bg-gray-800 text-white px-4 py-2 rounded hover:bg-gray-600 transition font-medium cursor-pointer border-0">
    Copy shareable link
  </button>
</div>
`;

const ERROR_TEMPLATE = `
<div class="text-center">
  <p class="text-red-600 font-semibold">⚠️ <%= it.message %></p>
  <a href="/" class="inline-block mt-4 bg-black text-white py-2 px-4 rounded hover:bg-gray-800 transition">← Back to home</a>
</div>
`;

export function renderErrorPage(message: string): string {
  const body = eta.renderString(ERROR_TEMPLATE, { message });
  return eta.renderString(LAYOUT_TEMPLATE, {
    title: 'Error – Private Article Reader',
    body,
    scripts: '',
  });
}

export function renderArticlePage(article: ArticleData, sourceUrl: string): string {
  const publishedDate = article.published
    ? new Date(article.published).toLocaleDateString()
    : 'Publishing time not found';
  const author = article.author ?? 'No author found';
  const shareUrl = `/?url=${encodeURIComponent(sourceUrl)}`;

  const body = eta.renderString(ARTICLE_TEMPLATE, {
    article: { ...article, author },
    sourceUrl,
    publishedDate,
    shareUrl,
  });

  return eta.renderString(LAYOUT_TEMPLATE, {
    title: `${article.title} – Private Article Reader`,
    body,
    scripts: `<script src="/reader-controls.js"></script>`,
  });
}
