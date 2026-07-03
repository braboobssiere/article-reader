export function buildContentSecurityPolicy(nonce: string): string {
  const turnstileOrigin = 'https://challenges.cloudflare.com';
  const vercelAnalyticsOrigins = [
    'https://va.vercel-scripts.com',
    'https://vitals.vercel-insights.com',
  ];

  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    turnstileOrigin,
    ...vercelAnalyticsOrigins,
  ].join(' ');

  const connectSrc = [
    "'self'",
    turnstileOrigin,
    ...vercelAnalyticsOrigins,
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
    `frame-src ${turnstileOrigin}`,
    "object-src 'none'",
  ].join('; ');
}
