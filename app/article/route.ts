import { z } from 'zod';
import { validateUrl } from '@/lib/ssrf';
import { verifyTurnstile } from '@/lib/turnstile';
import { fetchAndParseArticle, getCached, setCached } from '@/lib/article';
import { renderArticlePage, renderErrorPage } from '@/lib/render';

const HTML_HEADERS = { 'Content-Type': 'text/html; charset=utf-8' };
const urlSchema = z.string().url().min(1);

function errorResponse(message: string, status: number) {
  return new Response(renderErrorPage(message), { status, headers: HTML_HEADERS });
}

async function handleArticle(
  rawUrl: string | null,
  turnstileToken: string | null,
  ip: string,
  checkTurnstile: boolean,
  bypassCache = false,
) {
  if (!rawUrl) return errorResponse('Missing URL parameter.', 400);
  try {
    urlSchema.parse(rawUrl);
  } catch {
    return errorResponse('Invalid URL format.', 400);
  }
  let validUrl: string;
  try {
    validUrl = validateUrl(rawUrl).href;
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : 'Invalid URL', 400);
  }
  if (checkTurnstile && process.env.TURNSTILE_ENABLED === 'true') {
    if (!process.env.TURNSTILE_SECRET_KEY)
      return errorResponse('Server configuration error: TURNSTILE_SECRET_KEY is not set.', 500);
    if (!turnstileToken)
      return errorResponse('CAPTCHA token missing. Please refresh and try again.', 400);
    const ok = await verifyTurnstile(turnstileToken, ip);
    if (!ok) return errorResponse('CAPTCHA verification failed. Please try again.', 403);
  }
  if (!bypassCache) {
    const cached = await getCached(validUrl);
    if (cached)
      return new Response(renderArticlePage(cached, validUrl), { headers: HTML_HEADERS });
  }
  try {
    const article = await fetchAndParseArticle(validUrl);
    void setCached(validUrl, article);
    return new Response(renderArticlePage(article, validUrl), { headers: HTML_HEADERS });
  } catch (err) {
    console.error('[article]', err);
    return errorResponse('Failed to fetch or parse the article. Please try again later.', 500);
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
  const bypassCache = body.get('latest') === '1';
  return handleArticle(url, token, ip, true, bypassCache);
}
