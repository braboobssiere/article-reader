import { validateUrl } from '@/lib/ssrf';
import { verifyTurnstile } from '@/lib/turnstile';
import { fetchAndParseArticle, getCached, setCached } from '@/lib/article';

function err(message: string, status: number) {
  return new Response(message, { status });
}

async function extractArticle(req: Request) {
  let body: { url?: string; turnstileToken?: string };
  try {
    body = await req.json();
  } catch {
    return err('Request body must be valid JSON with a "url" field.', 400);
  }

  if (!body?.url || typeof body.url !== 'string') {
    return err('Missing "url" field.', 400);
  }

  let validUrl: string;
  try {
    validUrl = validateUrl(body.url).href;
  } catch (e) {
    return err(e instanceof Error ? e.message : 'Invalid URL', 400);
  }

  if (process.env.TURNSTILE_ENABLED === 'true') {
    if (!process.env.TURNSTILE_SECRET_KEY) return err('Server configuration error.', 500);

    if (!body.turnstileToken) return err('Turnstile token missing.', 400);

    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      req.headers.get('x-real-ip') ??
      '';

    const ok = await verifyTurnstile(body.turnstileToken, ip);
    if (!ok) return err('CAPTCHA verification failed.', 403);
  }

  const cached = getCached(validUrl);
  if (cached) return Response.json(cached);

  const userAgent = req.headers.get('user-agent') ?? undefined;

  try {
    const article = await fetchAndParseArticle(validUrl, userAgent);
    setCached(validUrl, article);
    return Response.json(article);
  } catch (e) {
    console.error('[api/extract]', e);
    return err(e instanceof Error ? e.message : 'Extraction failed', 500);
  }
}

export { extractArticle as POST };
