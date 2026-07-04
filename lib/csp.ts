export function buildContentSecurityPolicy(nonce: string): string {
  const turnstileOrigin = 'https://challenges.cloudflare.com';
  const vercelOrigins = [
    'https://va.vercel-scripts.com',
    'https://vitals.vercel-insights.com',
    'https://vercel.live',
  ];

  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    turnstileOrigin,
    ...vercelOrigins,
  ].join(' ');

  const connectSrc = [
    "'self'",
    turnstileOrigin,
    ...vercelOrigins,
  ].join(' ');

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "manifest-src 'self'",
    `connect-src ${connectSrc}`,
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    `frame-src https:`,
    "object-src 'none'",
  ].join('; ');
}
