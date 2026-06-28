# Private Article Reader — Vercel Edition

Fetches and extracts article content from any public URL, stripping trackers, scripts, and clutter for a clean, distraction-free reading experience. Built with **Next.js App Router** for Vercel.

---

## ✨ Features

- **Article extraction** — Mozilla's `@mozilla/readability` extracts the main content.
- **Clean reader view** — configurable theme (sepia / light / dark), font size, and reading width. Preferences are saved to `localStorage`.
- **Shareable links** — `GET /article?url=…` lets you bookmark or share any article.
- **History** — last 100 URLs saved in `localStorage` for quick re-access.
- **Mobile-optimised** — full-width on small screens with a compact toolbar.
- **SSRF protection** — `ssrf-guard` blocks private IPs, localhost, and metadata endpoints.
- **In-process cache** — articles are cached for 1 hour per serverless instance.
- **Optional Turnstile** — protect the form from bots with Cloudflare Turnstile.

---

## 🗺 Routes

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Homepage with URL form and history |
| `POST` | `/article` | Submit URL form (Turnstile-verified if enabled) |
| `GET` | `/article?url=…` | Direct / shareable article link (no Turnstile) |
| `POST` | `/api/extract` | JSON API — returns `ArticleData` |

### `ArticleData` shape

```json
{
  "title": "string",
  "content": "<html>",
  "author": "string | null",
  "published": "ISO8601 | null",
  "image": "url | null",
  "ttr": 120
}
```

`ttr` is estimated reading time in **seconds**.

---

## 🚀 Deploy to Vercel

### 1 — Clone & install

```bash
git clone https://github.com/yourname/private-article-reader.git
cd private-article-reader
npm install
```

### 2 — Environment variables

```bash
cp .env.example .env.local
# Edit .env.local — Turnstile is optional, leave TURNSTILE_ENABLED=false to skip
```

### 3 — Local dev

```bash
npm run dev
# → http://localhost:3000
```

### 4 — Deploy

```bash
npx vercel
```

Or push to a GitHub repo and import it at <https://vercel.com/new> — Vercel auto-detects Next.js.

---

## ⚙️ Environment variables

Set these in **Vercel → Project → Settings → Environment Variables** (or `.env.local` for dev):

| Variable | Default | Description |
|----------|---------|-------------|
| `TURNSTILE_ENABLED` | `false` | Set to `true` to enable bot protection |
| `TURNSTILE_SITE_KEY` | — | Turnstile site key (public) |
| `TURNSTILE_SECRET_KEY` | — | Turnstile secret key (never expose client-side) |

---

## 🗃 Caching

The in-process `Map` cache is **per serverless function instance** and does not persist across cold starts or concurrent instances — same behaviour as the original Cloudflare Worker without KV.

To add a shared cache, wire in **Vercel KV** (Upstash Redis):

```ts
// lib/article.ts — replace getCached / setCached with:
import { kv } from '@vercel/kv';

export async function getCached(url: string) {
  return kv.get<ArticleData>(url);
}
export async function setCached(url: string, data: ArticleData) {
  await kv.set(url, data, { ex: 3600 });
}
```

---

## 🔒 Security

- **SSRF** — `ssrf-guard` blocks private IPs, RFC-1918 ranges, loopback, link-local, and cloud metadata endpoints.
- **XSS** — `sanitize-html` strips all `on*` event handlers and `javascript:` hrefs from extracted content.
- **Security headers** — `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` set globally in `vercel.json`.

---

## 📦 Stack

| What | Package |
|------|---------|
| Framework | Next.js 15 (App Router) |
| Parsing | `linkedom` + `@mozilla/readability` |
| Sanitisation | `sanitize-html` |
| SSRF protection | `ssrf-guard` |
| Styling | Tailwind CSS CDN |
