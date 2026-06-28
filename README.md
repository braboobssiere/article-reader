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
- **Optional Cloudflare KV cache** — cache articles for **1 day** across serverless instances. Falls back to in‑memory cache if Cloudflare KV is unavailable or disabled.
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
git clone https://github.com/braboobssiere/article-reader.git
cd private-article-reader
npm install
```

### 2 — Environment variables

```bash
cp .env.example .env.local
# Edit .env.local – Turnstile and Cloudflare KV are optional
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
| `CLOUDFLARE_KV_ENABLED` | `false` | Set to `true` to enable Cloudflare KV caching |
| `CLOUDFLARE_ACCOUNT_ID` | — | Your Cloudflare account ID (public) |
| `CLOUDFLARE_KV_NAMESPACE_ID` | — | Your KV namespace ID (public) |
| `CLOUDFLARE_API_TOKEN` | — | Cloudflare API token with **KV Storage Write** permission (🔒 secret) |

> **Note**: `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_KV_NAMESPACE_ID` are not secrets, but `CLOUDFLARE_API_TOKEN` must be encrypted.

---

## 🗃 Caching

The app now supports **optional Cloudflare KV** for persistent caching across all serverless instances.

- When `CLOUDFLARE_KV_ENABLED=true`, articles are stored in Cloudflare KV with a **TTL of 1 day** (86,400 seconds).
- If Cloudflare KV is **disabled** or **unavailable**, the app falls back to an in‑memory `Map` cache (1‑hour TTL, per instance).
- Cache functions are `async`, so they integrate seamlessly with Next.js serverless functions.

To configure Cloudflare KV, you need:
1. A Cloudflare account.
2. A KV namespace (created in the Cloudflare dashboard under Workers & Pages → KV).
3. An API token with `Workers KV Storage` write permissions.
4. The environment variables listed above.

### Setting up Cloudflare KV

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com) → Workers & Pages → KV.
2. Create a new namespace (e.g., `article-cache`). Copy its **Namespace ID**.
3. Under **My Profile** → **API Tokens**, create a token with **Workers KV Storage → Write** permission.
4. Copy your **Account ID** from the Workers & Pages overview.
5. Add all three values to your environment variables.

If you don't want to use Cloudflare KV, leave `CLOUDFLARE_KV_ENABLED=false` – the app will keep using the in‑memory cache.

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
| Cache | Optional Cloudflare KV (REST API) + in‑memory fallback |
| Styling | Tailwind CSS CDN |
