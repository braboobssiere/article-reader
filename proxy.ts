import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { buildContentSecurityPolicy } from '@/lib/csp';

const excludedPaths = ['/tailwind.css', '/reader-controls.js', '/favicon.ico'];

function isExcluded(path: string): boolean {
  if (path === '/' || path === '/article' || path.startsWith('/article/')) return false;
  if (excludedPaths.includes(path)) return true;
  if (path.startsWith('/api/')) return true;
  if (/\.(css|js|json|png|jpg|jpeg|gif|svg|ico|webp|ttf|woff2?)$/.test(path)) return true;
  return false;
}

function createNonce(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

function withNonce(request: NextRequest): NextResponse {
  const nonce = createNonce();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set('Content-Security-Policy', buildContentSecurityPolicy(nonce));
  return response;
}

export function proxy(request: NextRequest) {
  const { pathname, origin } = request.nextUrl;

  if (pathname === '/' || pathname === '/article' || pathname.startsWith('/article/')) {
    return withNonce(request);
  }

  if (isExcluded(pathname)) {
    return NextResponse.next();
  }

  let raw = decodeURIComponent(pathname.slice(1));
  raw = raw.replace(/^(https?:)\//, '$1//');
  if (!/^https?:\/\//i.test(raw)) {
    raw = `https://${raw}`;
  }

  let validUrl: string;
  try {
    validUrl = new URL(raw).href;
  } catch {
    return NextResponse.redirect(origin, 302);
  }

  const redirectUrl = new URL(`/?url=${encodeURIComponent(validUrl)}`, origin);
  return NextResponse.redirect(redirectUrl, 302);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
