import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { validateUrl } from './ssrf.ts';

describe('validateUrl', () => {
  it('accepts a normal public URL', () => {
    const url = validateUrl('https://example.com/article');
    assert.equal(url.hostname, 'example.com');
  });

  it('rejects localhost', () => {
    assert.throws(() => validateUrl('http://localhost/secret'), /Blocked host/);
  });

  it('rejects private IPv4', () => {
    assert.throws(() => validateUrl('http://192.168.1.1/'), /Blocked host/);
  });

  it('rejects link-local metadata endpoint', () => {
    assert.throws(() => validateUrl('http://169.254.169.254/'), /Blocked host/);
  });

  it('rejects .internal hostnames', () => {
    assert.throws(() => validateUrl('http://db.internal/'), /Blocked host/);
  });

  it('rejects non-http protocols', () => {
    assert.throws(() => validateUrl('file:///etc/passwd'), /Only http/);
  });

  it('rejects invalid URLs', () => {
    assert.throws(() => validateUrl('not a url'));
  });
});
