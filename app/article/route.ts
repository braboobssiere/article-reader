import { validateUrl } from '@/lib/ssrf';
import { verifyTurnstile } from '@/lib/turnstile';
import { fetchAndParseArticle, getCached, setCached } from '@/lib/article';
import { renderArticlePage, renderErrorPage } from '@/lib/render';

const HTML_HEADERS = { 'Content-Type': 'text/html; charset=utf-8' };

function errorResponse(message: string, status: number) {
  return new Response(renderErrorPage(message), { status, headers: HTML_HEADERS });
}

async function handleArticle(
  rawUrl: string | null,
  turnstileToken: string | null,
  ip: string,
  checkTurnstile: boolean,
) {
  if (!rawUrl) return errorResponse('Missing URL parameter.', 400);

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

  const cached = getCached(validUrl);
  if (cached)
    return new Response(renderArticlePage(cached, validUrl), { headers: HTML_HEADERS });

  try {
    const article = await fetchAndParseArticle(validUrl);
    setCached(validUrl, article);
    return new Response(renderArticlePage(article, validUrl), { headers: HTML_HEADERS });
  } catch (err) {
    console.error('[article]', err);
    return errorResponse(`Error: ${err instanceof Error ? err.message : 'Extraction failed'}`, 500);
  }
}

// GET /article?url=… — shareable links, no Turnstile
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  return handleArticle(searchParams.get('url'), null, '', false);
}

// POST /article — form submission, body parsed once here
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
  return handleArticle(url, token, ip, true);
}
