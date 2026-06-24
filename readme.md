# Private Article Reader

A Cloudflare Worker that fetches and extracts article content from any public URL, stripping trackers, scripts, and clutter for a clean, distraction‑free reading experience.  
It also includes a history of read articles (stored in the browser’s `localStorage`), reader preferences (theme, font size, width), and optional Turnstile CAPTCHA protection.

---

## ✨ Features

- **Article extraction** – uses Mozilla’s `@mozilla/readability` to extract the main content.
- **Clean reader view** – with configurable **theme** (sepia, light, dark), **font size** (±2px), and **reading width** (narrow, medium, wide).
- **History** – the last 100 URLs are saved in your browser’s `localStorage` for quick access.
- **Mobile‑optimised** – full‑width on small screens with a compact toolbar.
- **Security** – SSRF protection via [`ssrf-guard`](https://github.com/lxieyang/ssrf-guard) (blocks private IPs, localhost, metadata endpoints, and obfuscated addresses).
- **Caching** – articles are cached in memory and optionally in Cloudflare KV (1‑hour TTL) to reduce latency.
- **Optional Turnstile** – protect the submission form from bots using Cloudflare Turnstile.

---

## 📦 Technologies

- **Runtime**: [Cloudflare Workers](https://workers.cloudflare.com/)
- **Framework**: [Hono](https://hono.dev/) – lightweight, fast web framework.
- **Parsing**: [`linkedom`](https://github.com/WebReflection/linkedom) – fast DOM parser (compatible with Readability).
- **Extraction**: [`@mozilla/readability`](https://github.com/mozilla/readability) – article extraction.
- **SSRF protection**: [`ssrf-guard`](https://github.com/lxieyang/ssrf-guard) – pure JS, works in Workers.
- **Deployment**: [Wrangler](https://developers.cloudflare.com/workers/wrangler/) – the official CLI.

---

## 🚀 Setup & Deployment

### 1. Prerequisites

- Node.js ≥ 24 (or use the `.node-version` file with `fnm`/`nvm`).
- A Cloudflare account with Workers enabled.
- (Optional) A Cloudflare KV namespace for caching.

### 2. Clone & Install

```bash
git clone https://github.com/braboobssiere/article-reader.git
cd article-reader
npm install
