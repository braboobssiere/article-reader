import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const excludedPaths = ['/', '/article', '/tailwind.css', '/reader-controls.js', '/favicon.ico'];

function isExcluded(path: string): boolean {
  if (excludedPaths.includes(path)) return true;
  if (path.startsWith('/api/')) return true;
  if (/\.(css|js|json|png|jpg|jpeg|gif|svg|ico|webp|ttf|woff2?)$/.test(path)) return true;
  return false;
}

export function proxy(request: NextRequest) {
  const { pathname, origin } = request.nextUrl;

  if (isExcluded(pathname)) {
    return NextResponse.next();
  }

  const hadTrailingSlash = pathname.endsWith('/');

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

  if (hadTrailingSlash && !validUrl.endsWith('/')) {
    validUrl += '/';
  }

  const redirectUrl = new URL(`/?url=${encodeURIComponent(validUrl)}`, origin);
  return NextResponse.redirect(redirectUrl, 302);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
