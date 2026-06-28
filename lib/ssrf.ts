import { isPrivateIp, isBlockedHostname, normalizeUrlHostname } from 'ssrf-guard';

export function validateUrl(rawUrl: string): URL {
  const url = new URL(rawUrl); // throws on invalid input

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http and https URLs are allowed');
  }

  const normalized = normalizeUrlHostname(url.hostname);
  const policy = {
    exact: ['localhost', 'metadata.google.internal', 'metadata.azure.internal'],
    suffixes: ['.local', '.internal'],
  };

  if (isPrivateIp(normalized) || isBlockedHostname(normalized, policy)) {
    throw new Error('Blocked host');
  }

  return url;
}
