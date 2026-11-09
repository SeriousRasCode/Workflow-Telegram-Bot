import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { createServer } from '../src/server/app.js';
import { config } from '../src/config.js';

describe('HTTP Webhook Server', () => {
  let server: http.Server;
  let serverUrl: string;
  const testSecret = 'server_test_secret_123';

  test.before((_, done) => {
    config.webhookSecret = testSecret;
    const app = createServer();
    server = app.listen(0, () => {
      const address = server.address() as any;
      serverUrl = `http://127.0.0.1:${address.port}`;
      done();
    });
  });

  test.after((_, done) => {
    server.close(done);
  });

  it('GET /health returns 200 and ok status', async () => {
    const res = await fetch(`${serverUrl}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.service, 'GitHub Telegram Bot');
  });

  it('POST /webhook with valid signature and ping event returns 200', async () => {
    const payload = JSON.stringify({
      zen: 'Design for failure.',
      hook_id: 9999,
      repository: { full_name: 'octocat/Hello-World' },
      sender: { login: 'octocat' },
    });

    const hmac = crypto.createHmac('sha256', testSecret).update(payload).digest('hex');

    const res = await fetch(`${serverUrl}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': 'ping',
        'X-GitHub-Delivery': '12345678-1234-1234-1234-123456789abc',
        'X-Hub-Signature-256': `sha256=${hmac}`,
      },
      body: payload,
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'success');
    assert.equal(body.event, 'ping');
  });

  it('POST /webhook with invalid signature returns 401 Unauthorized', async () => {
    const payload = JSON.stringify({ test: true });

    const res = await fetch(`${serverUrl}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': 'push',
        'X-GitHub-Delivery': '12345678-1234-1234-1234-123456789abd',
        'X-Hub-Signature-256': 'sha256=invalidhash12345678901234567890123456789012345678901234567890123456',
      },
      body: payload,
    });

    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error, 'Invalid webhook signature');
  });
});
