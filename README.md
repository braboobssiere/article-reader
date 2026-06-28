# 📰 Private Article Reader

Paste any article link. Get a clean, ad-free page to read it — no clutter, no distractions, no tracking.

Think of it as your own personal "Reader Mode" that works on any website, accessible from any device via a link you control.

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

You'll need [Node.js](https://nodejs.org) installed and a free [Vercel](https://vercel.com) account.

### Step 1 — Get the code

```bash
git clone https://github.com/braboobssiere/article-reader.git
cd article-reader
npm install
```

### Step 2 — Set up your config file

```bash
cp .env.example .env.local
```

Open `.env.local` in any text editor. Most of the settings are optional — see the table below.

### Step 3 — Try it locally

```bash
npm run dev
```

Then open `http://localhost:3000` in your browser. Paste an article URL and hit read.

### Step 4 — Put it on the internet (optional)

```bash
npx vercel
```

Follow the prompts. Vercel will give you a public URL. That's it — your reader is live.

> **Alternative:** Push your code to GitHub and import the repo at [vercel.com/new](https://vercel.com/new). Vercel detects everything automatically.

---

## Settings (environment variables)

These go in your `.env.local` file for local development, or in **Vercel → Project → Settings → Environment Variables** once deployed.

Most of these are **optional**. The app works fine without them.

| Setting | What it does | Do I need it? |
|---|---|---|
| `TURNSTILE_ENABLED` | Adds a CAPTCHA to stop bots from abusing your reader | Only if it's public-facing and you're worried about abuse |
| `TURNSTILE_SITE_KEY` | Public key for the CAPTCHA (from [Cloudflare Turnstile](https://dash.cloudflare.com)) | Only if you enabled Turnstile |
| `TURNSTILE_SECRET_KEY` | Secret key for the CAPTCHA — keep this private | Only if you enabled Turnstile |
| `CLOUDFLARE_KV_ENABLED` | Saves fetched articles in the cloud so repeat loads are instant | Nice to have, not required |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID | Only if you enabled KV |
| `CLOUDFLARE_KV_NAMESPACE_ID` | The ID of your article cache storage bucket | Only if you enabled KV |
| `CLOUDFLARE_API_TOKEN` | Secret token that lets the app write to the cache — keep this private | Only if you enabled KV |

> **Tip:** If you just want to try the app, leave all of these blank. It will still work — articles just won't be cached between restarts.

---

## Optional: Speed up repeat visits with caching

Without caching, every time someone opens an article, the app re-fetches it from the original site. That's fine for personal use.

If you want faster repeat loads (or you're sharing the reader with others), you can turn on Cloudflare KV caching. Articles will be stored for 24 hours so the second visit is nearly instant.

**How to set it up:**

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages → KV**.
2. Create a new namespace — call it anything, e.g. `article-cache`. Copy the **Namespace ID**.
3. Go to **My Profile → API Tokens** → create a token with **Workers KV Storage → Write** permission. Copy the token.
4. Copy your **Account ID** from the Workers & Pages overview page.
5. Add all three values to your environment variables and set `CLOUDFLARE_KV_ENABLED=true`.

---

## Privacy & safety notes

- The app only fetches **public URLs** — it cannot access anything that requires a login.
- It blocks attempts to fetch internal network addresses (like `localhost` or private IP ranges), so it's safe to host for others.
- Extracted article content is sanitised to remove anything that could run malicious code.
- Security headers are set automatically when deployed to Vercel.

---

## Tech used (for the curious)

| Piece | What it is |
|---|---|
| Next.js 15 | The web framework that runs everything |
| @mozilla/readability | Mozilla's article extractor (same one Firefox uses) |
| sanitize-html | Removes any dangerous code from extracted content |
| ssrf-guard | Blocks requests to internal/private addresses |
| Cloudflare KV | Optional cloud storage for caching articles |
| Tailwind CSS | Handles the styling |
