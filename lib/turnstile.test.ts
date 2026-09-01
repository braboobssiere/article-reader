import { strict as assert } from 'node:assert';
import { describe, it, mock } from 'node:test';
import { verifyTurnstile } from './turnstile';

describe('verifyTurnstile', () => {
  it('includes an idempotency key in the verification request', async () => {
    const originalFetch = global.fetch;
    let receivedBody: FormData | null = null;

    process.env.TURNSTILE_SECRET_KEY = 'secret-key';

    global.fetch = mock.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      receivedBody = init?.body instanceof FormData ? init.body : null;
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const ok = await verifyTurnstile('token-value', '203.0.113.5');
      assert.equal(ok, true);
      assert.ok(receivedBody);
      assert.equal((receivedBody as FormData).get('secret'), 'secret-key');
      assert.equal((receivedBody as FormData).get('response'), 'token-value');
      assert.equal((receivedBody as FormData).get('remoteip'), '203.0.113.5');
      assert.ok((receivedBody as FormData).get('idempotency_key'));
    } finally {
      global.fetch = originalFetch;
    }
  });
});
