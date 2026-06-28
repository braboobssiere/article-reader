# Private Article Reader — Vercel Edition

A lightweight, serverless article reader that fetches and extracts clean content from any public URL. Built with **Next.js 15 (App Router)** and designed for deployment on **Vercel**.

## ✨ Features

- **Clutter‑free reading** – Strips trackers, scripts, and ads using Mozilla’s `@mozilla/readability`.
- **Customisable reader view** – Adjust theme (sepia / light / dark), font size, and reading width. Preferences are saved locally.
- **Shareable links** – `GET /article?url=…` returns a clean, bookmark‑friendly article page.
- **History** – The last 100 URLs are stored in `localStorage` for quick re‑access.
- **Mobile‑optimised** – Responsive layout with a compact toolbar on small screens.
- **SSRF protection** – `ssrf‑guard` blocks private IPs, localhost, and metadata endpoints.
- **In‑process caching** – Articles are cached for 1 hour per serverless instance (no external KV required).
- **Optional bot protection** – Cloudflare Turnstile can be enabled to protect the submission form.

## 🗺️ Routes

| Method | Path                     | Description                                                       |
|--------|--------------------------|-------------------------------------------------------------------|
| `GET`  | `/`                      | Homepage with URL form and history.                              |
| `POST` | `/article`               | Submit a URL via form (Turnstile‑verified if enabled).           |
| `GET`  | `/article?url=…`         | Direct / shareable link – **redirects to home** with prefilled URL. |
| `POST` | `/api/extract`           | JSON API – returns `ArticleData` (requires Turnstile if enabled). |

### `ArticleData` Shape

```json
{
  "title": "string",
  "content": "<html>",
  "author": "string | null",
  "published": "ISO8601 | null",
  "image": "url | null",
  "ttr": 120   // estimated reading time in seconds
}
```

## 🚀 Deploy to Vercel

### 1. Clone & install

```bash
git clone https://github.com/yourname/private-article-reader.git
cd private-article-reader
npm install
```

### 2. Environment variables

Copy the example file and edit as needed:

```bash
cp .env.example .env.local
```

| Variable               | Default | Description                                    |
|------------------------|---------|------------------------------------------------|
| `TURNSTILE_ENABLED`    | `false` | Set to `true` to enable Turnstile protection. |
| `TURNSTILE_SITE_KEY`   | —       | Public site key (required if enabled).        |
| `TURNSTILE_SECRET_KEY` | —       | Secret key (required if enabled).             |

### 3. Local development

```bash
npm run dev
# → http://localhost:3000
```

### 4. Deploy to Vercel

```bash
npx vercel
```

Or push to a GitHub repo and import it at [vercel.com/new](https://vercel.com/new) – Vercel automatically detects Next.js.

For production, set the environment variables in **Vercel → Project → Settings → Environment Variables**.

## 🗃️ Caching

The in‑memory `Map` cache is per serverless instance and does not persist across cold starts or concurrent invocations. To add a shared cache, replace `getCached` / `setCached` in `lib/article.ts` with [Vercel KV](https://vercel.com/docs/storage/vercel-kv) or another Redis solution.

Example using `@vercel/kv`:

```ts
import { kv } from '@vercel/kv';

export async function getCached(url: string) {
  return kv.get<ArticleData>(url);
}
export async function setCached(url: string, data: ArticleData) {
  await kv.set(url, data, { ex: 3600 });
}
```

## 🔒 Security

- **SSRF** – `ssrf-guard` blocks private IPs, RFC‑1918 ranges, loopback, link‑local, and cloud metadata endpoints.
- **XSS** – `sanitize-html` strips all `on*` event handlers and `javascript:` hrefs from extracted content.
- **Security headers** – Enforced via `vercel.json`:
  - `X-Frame-Options: DENY`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: no-referrer`
  - `Strict-Transport-Security`
  - `Content-Security-Policy`

## 🧰 Stack

| Purpose            | Package                           |
|--------------------|-----------------------------------|
| Framework          | Next.js 15 (App Router)           |
| HTML parsing       | `linkedom`                        |
| Content extraction | `@mozilla/readability`            |
| Metadata scraping  | `metascraper` + plugins           |
| Sanitisation       | `sanitize-html`                   |
| SSRF protection    | `ssrf-guard`                      |
| Styling            | Tailwind CSS (CDN)                |
| Deployment         | Vercel                            |

## 📝 Notes

- The `/article` GET route **redirects** to the homepage with the URL prefilled – this encourages users to interact with the form (and Turnstile, if enabled).
- The JSON API (`/api/extract`) is intended for programmatic use; it also respects the Turnstile setting.
- All user preferences (theme, font size, width) are stored in `localStorage` and apply on the article page.

## 📄 License

[MIT](https://choosealicense.com/licenses/mit/)
