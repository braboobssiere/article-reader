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

Choose the path that suits you:

- **Browser only** — no terminal, no installs. Deployed in ~5 minutes. *(recommended if you just want to use it)*
- **Local** — run it on your own machine first, then deploy. *(better if you want to modify the code)*

---

### Option A — Browser only (no installs needed)

You only need a [GitHub](https://github.com) account and a free [Vercel](https://vercel.com) account.

**Step 1 — Fork the repo**

Go to [github.com/braboobssiere/article-reader](https://github.com/braboobssiere/article-reader) and click the **Fork** button (top-right). This copies the project into your own GitHub account.

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

## Settings (environment variables)

**Browser-only users:** add these in **Vercel → Project → Settings → Environment Variables**.
**Local users:** add these to your `.env.local` file, or in Vercel once deployed.

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
| `CLOUDFLARE_KV_TTL` | How long (in seconds) to keep an article in the cache. Default is `86400` (1 day). Set to `3600` for 1 hour, `604800` for 1 week. | Only if you enabled KV |

> **Tip:** If you just want to try the app, leave all of these blank. It will still work — articles just won't be cached between restarts.

---

## Optional: Speed up repeat visits with caching

Without caching, every time someone opens an article, the app re-fetches it from the original site. That's fine for personal use.

If you want faster repeat loads (or you're sharing the reader with others), you can turn on Cloudflare KV caching. Articles will be stored and reused for as long as you configure — the default is 24 hours.

**How to set it up:**

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages → KV**.
2. Create a new namespace — call it anything, e.g. `article-cache`. Copy the **Namespace ID**.
3. Go to **My Profile → API Tokens** → create a token with **Workers KV Storage → Write** permission. Copy the token.
4. Copy your **Account ID** from the Workers & Pages overview page.
5. Add all three values to your environment variables and set `CLOUDFLARE_KV_ENABLED=true`.
6. (Optional) Set `CLOUDFLARE_KV_TTL` to control how long articles are cached, in seconds. Leave it out to use the default of 86400 (1 day).

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
