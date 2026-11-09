import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { connectionMatches } from '../src/worker.js';

describe('Cloudflare webhook connection scope', () => {
  it('accepts organization webhooks for that organization', () => {
    assert.equal(connectionMatches('acme', { organization: { login: 'Acme' }, repository: { full_name: 'acme/api' } }), true);
    assert.equal(connectionMatches('acme', { organization: { login: 'other' }, repository: { full_name: 'other/api' } }), false);
  });

  it('accepts only the linked repository for repository webhooks', () => {
    assert.equal(connectionMatches('alice/my-repo', { repository: { full_name: 'Alice/My-Repo' } }), true);
    assert.equal(connectionMatches('alice/my-repo', { repository: { full_name: 'alice/other' } }), false);
    assert.equal(connectionMatches('alice/my-repo', { organization: { login: 'alice' } }), false);
  });
});
