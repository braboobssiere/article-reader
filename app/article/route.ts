import { validateUrl } from '@/lib/ssrf';
import { verifyTurnstile } from '@/lib/turnstile';
import { fetchAndParseArticle, getCached, setCached } from '@/lib/article';
import { renderArticlePage, renderErrorPage } from '@/lib/render';

const HTML_HEADERS = { 'Content-Type': 'text/html; charset=utf-8' };

function errorResponse(message: string, status: number) {
  return new Response(renderErrorPage(message), { status, headers: HTML_HEADERS });
}

// ── Shared handler ─────────────────────────────────────────────────────────
async function handleArticle(rawUrl: string | null, req: Request, checkTurnstile: boolean) {
  if (!rawUrl) return errorResponse('Missing URL parameter.', 400);

  let validUrl: string;
  try {
    validUrl = validateUrl(rawUrl).href;
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : 'Invalid URL', 400);
  }

  if (checkTurnstile && process.env.TURNSTILE_ENABLED === 'true') {
    if (!process.env.TURNSTILE_SECRET_KEY) {
      return errorResponse('Server configuration error: TURNSTILE_SECRET_KEY is not set.', 500);
    }

    // Extract token — support both form field names for compatibility
    const body = await req.clone().formData().catch(() => new FormData());
    const token =
      (body.get('cf-turnstile-response') as string | null) ??
      (body.get('turnstileToken') as string | null) ??
      '';

    if (!token) return errorResponse('CAPTCHA token missing. Please refresh and try again.', 400);

    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      req.headers.get('x-real-ip') ??
      '';

    const ok = await verifyTurnstile(token, ip);
    if (!ok) return errorResponse('CAPTCHA verification failed. Please try again.', 403);
  }

  const cached = getCached(validUrl);
  if (cached) {
    return new Response(renderArticlePage(cached, validUrl), { headers: HTML_HEADERS });
  }

  try {
    const article = await fetchAndParseArticle(validUrl);
    setCached(validUrl, article);
    return new Response(renderArticlePage(article, validUrl), { headers: HTML_HEADERS });
  } catch (err) {
    console.error('[article]', err);
    const msg = err instanceof Error ? err.message : 'Extraction failed';
    return errorResponse(`Error: ${msg}`, 500);
  }
}

// ── GET /article?url=... ── shareable links, no Turnstile ──────────────────
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  return handleArticle(searchParams.get('url'), req, false);
}

// ── POST /article ── form submission, Turnstile verified if enabled ─────────
export async function POST(req: Request) {
  const body = await req.formData().catch(() => new FormData());
  return handleArticle(body.get('url') as string | null, req, true);
}
