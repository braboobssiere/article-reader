import { z } from 'zod';
import { validateUrl } from '@/lib/ssrf';
import { verifyTurnstile } from '@/lib/turnstile';
import { fetchAndParseArticle, getCached, setCached } from '@/lib/article';
import { buildContentSecurityPolicy } from '@/lib/csp';
import { renderArticlePage, renderErrorPage } from '@/lib/render';

const HTML_HEADERS = { 'Content-Type': 'text/html; charset=utf-8' };
const urlSchema = z.string().url().min(1);

// ── Rate limiter ─────────────────────────────────────────────────────
const rateLimitMap = new Map<string, number>();
const RATE_LIMIT_MS = 5000; // 5 seconds

function checkRateLimit(ip: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const last = rateLimitMap.get(ip);
  if (last && now - last < RATE_LIMIT_MS) {
    return { allowed: false, retryAfter: Math.ceil((last + RATE_LIMIT_MS - now) / 1000) };
  }
  rateLimitMap.set(ip, now);
  // Clean up old entries periodically
  if (rateLimitMap.size > 1000) {
    for (const [key, time] of rateLimitMap) {
      if (now - time > RATE_LIMIT_MS) rateLimitMap.delete(key);
    }
  }
  return { allowed: true };
}

function htmlResponse(body: string, status: number, nonce?: string) {
  const headers = new Headers(HTML_HEADERS);
  if (nonce) {
    headers.set('Content-Security-Policy', buildContentSecurityPolicy(nonce));
  }
  return new Response(body, { status, headers });
}

function errorResponse(message: string, status: number, nonce?: string) {
  return htmlResponse(renderErrorPage(message), status, nonce);
}

async function handleArticle(
  rawUrl: string | null,
  turnstileToken: string | null,
  ip: string,
  nonce: string | null,
  checkTurnstile: boolean,
  bypassCache = false,
) {
  if (!rawUrl) return errorResponse('Missing URL parameter.', 400, nonce ?? undefined);
  try {
    urlSchema.parse(rawUrl);
  } catch {
    return errorResponse('Invalid URL format.', 400, nonce ?? undefined);
  }
  let validUrl: string;
  try {
    validUrl = validateUrl(rawUrl).href;
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : 'Invalid URL', 400, nonce ?? undefined);
  }
  if (checkTurnstile && process.env.TURNSTILE_ENABLED === 'true') {
    if (!process.env.TURNSTILE_SECRET_KEY)
      return errorResponse('Server configuration error: TURNSTILE_SECRET_KEY is not set.', 500, nonce ?? undefined);
    if (!turnstileToken)
      return errorResponse('CAPTCHA token missing. Please refresh and try again.', 400, nonce ?? undefined);
    const ok = await verifyTurnstile(turnstileToken, ip);
    if (!ok) return errorResponse('CAPTCHA verification failed. Please try again.', 403, nonce ?? undefined);
  }
  if (!bypassCache) {
    const cached = await getCached(validUrl);
    if (cached) {
      return htmlResponse(renderArticlePage(cached, validUrl, nonce ?? undefined), 200, nonce ?? undefined);
    }
  }
  try {
    const article = await fetchAndParseArticle(validUrl);
    await setCached(validUrl, article);
    return htmlResponse(renderArticlePage(article, validUrl, nonce ?? undefined), 200, nonce ?? undefined);
  } catch (err) {
    console.error('[article]', err);
    return errorResponse('Failed to fetch or parse the article. Please try again later.', 500, nonce ?? undefined);
  }
}

export async function GET(req: Request) {
  const { searchParams, origin } = new URL(req.url);
  const url = searchParams.get('url');
  const dest = url ? `${origin}/?url=${encodeURIComponent(url)}` : `${origin}/`;
  return Response.redirect(dest, 302);
}

export async function POST(req: Request) {
  const body = await req.formData();
  const url = body.get('url') as string | null;
  const token =
    (body.get('cf-turnstile-response') as string | null) ??
    (body.get('turnstileToken') as string | null);
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    '';

  // Rate limit check
  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    return new Response(
      `Too many requests. Please wait ${rate.retryAfter} seconds.`,
      { status: 429, headers: { 'Retry-After': String(rate.retryAfter) } }
    );
  }

  const nonce = req.headers.get('x-nonce');
  const bypassCache = body.get('latest') === '1';
  return handleArticle(url, token, ip, nonce, true, bypassCache);
}
