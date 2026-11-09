import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { connectionMatches, isChannelPost } from '../src/worker.js';

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

describe('Telegram channel commands', () => {
  it('accepts a channel post without an individual sender', () => {
    assert.equal(isChannelPost({ channel_post: { chat: { id: -100123, type: 'channel' }, text: '/subscribe owner/repo' } }), true);
    assert.equal(isChannelPost({ message: { chat: { id: -100123, type: 'supergroup' }, text: '/subscribe owner/repo' } }), false);
  });
});
