# 📰 Private Article Reader

Paste any article link. Get a clean, ad-free page to read it — no clutter, no distractions, no tracking.

Your own personal Reader Mode — accessible from any device via a link you control. Paste any article and read it without distractions, trackers, or clutter. Works on most websites, though some may block automated requests.

---

## What it does

You give it a URL. It fetches the article, strips out the ads and noise, and shows you just the words and images that matter. You can customise how it looks, bookmark articles, and even share clean links with friends.

---

## Features

- **Clean reading view** — removes ads, banners, sidebars, and cookie pop-ups from any article.
- **Themes** — switch between Sepia (warm), Light, and Dark. Your preference is remembered.
- **Font & width controls** — make the text bigger, smaller, wider, or narrower to suit you.
- **Shareable links** — every article gets a clean link you can bookmark or send to someone (e.g. `yoursite.com/article?url=…`).
- **History** — your last 100 articles are saved so you can jump back quickly.
- **Mobile-friendly** — works well on phones and tablets.
- **Safe by design** — the app can only fetch public web pages. It cannot be tricked into accessing your private network or server internals.

---

## Getting it running

Choose the path that suits you:

- **Browser only** — no terminal, no installs. Deployed in ~5 minutes. *(recommended if you just want to use it)*
- **Local** — run it on your own machine first, then deploy. *(better if you want to modify the code)*

---

### Option A — Browser only (no installs needed)

You only need a [GitHub](https://github.com) account and a free [Vercel](https://vercel.com) account.

**Step 1 — Fork the repo**

[Click here](https://github.com/braboobssiere/article-reader/fork). This copies the project into your own GitHub account.

**Step 2 — Import into Vercel**

1. Go to [vercel.com/new](https://vercel.com/new) and sign in.
2. Click **Import** next to the forked repo.
3. Leave all the build settings as-is — Vercel detects everything automatically.
4. (Optional) Add any environment variables now, or skip and add them later under **Project → Settings → Environment Variables**. See the [Settings table](#settings-environment-variables) below.
5. Click **Deploy**.

Vercel will give you a public URL (e.g. `your-reader.vercel.app`). Open it, paste an article URL, and you're reading.

---

### Option B — Run it locally

You'll need [Node.js](https://nodejs.org) installed.

**Step 1 — Get the code**

```bash
git clone https://github.com/braboobssiere/article-reader.git
cd article-reader
npm install
```

**Step 2 — Set up your config file**

```bash
cp .env.example .env.local
```

Open `.env.local` in any text editor. Most settings are optional — see the [Settings table](#settings-environment-variables) below.

**Step 3 — Start it up**

```bash
npm run dev
```

Open `http://localhost:3000` in your browser. Paste an article URL and hit read.

**Step 4 — Deploy when ready (optional)**

```bash
npx vercel
```

Follow the prompts. Vercel will give you a public URL.

---

## Optional: Protect the reader from bots with Turnstile

If you deploy this app publicly, bots and automated scrapers may repeatedly hit the `/article` endpoint. This wastes bandwidth, increases your Vercel costs, and can get your server IP rate‑limited by news sites.

[Cloudflare Turnstile](https://www.cloudflare.com/products/turnstile/) adds a simple, privacy‑preserving CAPTCHA to the submission form. Legitimate human users solve it effortlessly (no puzzles or images – just a single click), while automated requests are blocked before they reach the article fetcher.

**How to set it up:**

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com/) → **Turnstile**.
2. Click **Add a site** and give it a name (e.g. `article-reader`).
3. Add your domain(s) to the **Domain** field (e.g. `vercel.app`, or `localhost` for local testing).
4. Copy the **Site Key** and **Secret Key**.
5. Choose security level and pre‑cache options.
6. Add these values to your environment variables:
   - `TURNSTILE_SITE_KEY=your-site-key` (Plain text)
   - `TURNSTILE_SECRET_KEY=your-secret-key` (🔒 Secret)
   - `TURNSTILE_ENABLED=true` (Plain text)

That's it. The CAPTCHA will appear on the home page. Users only need to verify once per session.

---

## Optional: Speed up repeat visits with caching

Without caching, every time someone opens an article, the app re-fetches it from the original site. That's fine for personal use.

If you want faster repeat loads (or you're sharing the reader with others), you can turn on Cloudflare KV caching. Articles will be stored and reused for as long as you configure — the default is 24 hours.

**How to set it up:**

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages → KV**.
2. Create a new namespace — call it anything, e.g. `article-cache`. Copy the **Namespace ID**.
3. Go to **My Profile → API Tokens** → create a token with **Workers KV Storage → Modify** permission. Copy the token.
4. Copy your **Account ID** from the Workers & Pages overview page.
5. Add these values to your environment variables:
   - `CLOUDFLARE_ACCOUNT_ID=your-account-id` (Plain text)
   - `CLOUDFLARE_KV_NAMESPACE_ID=your-namespace-id` (Plain text)
   - `CLOUDFLARE_API_TOKEN=your-api-token` (🔒 Secret)
   - `CLOUDFLARE_KV_ENABLED=true` (Plain text)
   - (Optional) Set `CLOUDFLARE_KV_TTL` to control how long articles are cached, in seconds. Default is `86400` (1 day) and minimum is `3600` (1 hour).

> **Tip:** You can bypass the cache and fetch the latest version of an article by checking the **"LIVE"** checkbox when submitting a URL. This forces a fresh fetch and updates the cached copy.

---

## Settings (environment variables)

**Browser-only users:** add these in **Vercel → Project → Settings → Environment Variables**.

**Local users:** add these to your `.env.local` file, or in Vercel once deployed.

Most of these are **optional**. The app works fine without them.

| Setting | What it does | Type | Do I need it? |
|---|---|---|---|
| `TURNSTILE_ENABLED` | Adds a CAPTCHA to stop bots from abusing your reader | Plain text | Only if it's public-facing and you're worried about abuse |
| `TURNSTILE_SITE_KEY` | Public key for [Cloudflare Turnstile](https://www.cloudflare.com/products/turnstile/) | Plain text | Only if you enabled Turnstile |
| `TURNSTILE_SECRET_KEY` | Secret key for the CAPTCHA | 🔒 Secret | Only if you enabled Turnstile |
| `CLOUDFLARE_KV_ENABLED` | Saves fetched articles in the cloud so repeat loads are instant | Plain text | Nice to have, not required |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID | Plain text | Only if you enabled KV |
| `CLOUDFLARE_KV_NAMESPACE_ID` | The ID of your article cache storage bucket | Plain text | Only if you enabled KV |
| `CLOUDFLARE_API_TOKEN` | Token that lets the app write to the cache | 🔒 Secret | Only if you enabled KV |
| `CLOUDFLARE_KV_TTL` | How long (in seconds) to keep an article in the cache. Default is `86400` (1 day). | Plain text | Only if you enabled KV |

> **Tip:** If you just want to try the app, leave all of these blank. It will still work — articles just won't be cached between restarts.

---

## Privacy & safety notes

- The app only fetches **public URLs** — it cannot access anything that requires a login.
- **Images are loaded directly in your browser** when viewing an article. This means the original source website may see your IP address and browser fingerprint. The server does not proxy images; they are loaded client‑side to preserve bandwidth and performance.
- It blocks attempts to fetch internal network addresses (like `localhost` or private IP ranges), so it's safe to host for others.
- Extracted article content is sanitised to remove anything that could run malicious code.
- Security headers are set automatically when deployed to Vercel.

---

## Tech used

| Piece | What it is |
|---|---|
| Next.js | The web framework that runs everything |
| [defuddle](https://github.com/kepano/defuddle) | Article extraction (handles title, author, date, image, and content in one pass) |
| [sanitize-html](https://github.com/apostrophecms/apostrophe/tree/main/packages/sanitize-html) | Removes any dangerous code from extracted content |
| [linkedom](https://github.com/WebReflection/linkedom) | Lightweight DOM parser for server‑side extraction |
| [Eta](https://eta.js.org/) | Lightweight templating engine for rendering HTML pages |
| [ssrf-guard](https://github.com/jonathanong/ssrf-guard) | Blocks requests to internal/private addresses |
| [Cloudflare KV](https://developers.cloudflare.com/kv/) | Optional cloud storage for caching articles |
| Brotli | Compresses cached article data – reduces memory usage and KV storage/bandwidth |
| Tailwind CSS | Handles the styling |
