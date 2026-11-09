import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { verifyGitHubSignature } from '../src/github/verify.js';
import { SettingsStore } from '../src/storage/store.js';
import { parseAndDispatchGitHubEvent } from '../src/github/dispatcher.js';
import { formatPushEvent } from '../src/github/formatters/push.js';
import { formatPullRequestEvent } from '../src/github/formatters/pull_request.js';
import { formatIssueEvent } from '../src/github/formatters/issue.js';
import { formatReleaseEvent } from '../src/github/formatters/release.js';
import { formatWorkflowEvent } from '../src/github/formatters/workflow.js';
import fs from 'node:fs';
import path from 'node:path';

describe('GitHub Signature Verification', () => {
  const secret = 'my_super_secret_webhook_key_123';
  const payload = JSON.stringify({ zen: 'Keep it logically awesome.', hook_id: 12345 });

  it('should verify valid HMAC SHA-256 signature', () => {
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(payload);
    const validHeader = `sha256=${hmac.digest('hex')}`;

    const result = verifyGitHubSignature(validHeader, payload, secret);
    assert.equal(result, true);
  });

  it('should reject invalid HMAC signature', () => {
    const invalidHeader = 'sha256=abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
    const result = verifyGitHubSignature(invalidHeader, payload, secret);
    assert.equal(result, false);
  });

  it('should reject signature with wrong format or missing header', () => {
    assert.equal(verifyGitHubSignature(undefined, payload, secret), false);
    assert.equal(verifyGitHubSignature('invalid_format', payload, secret), false);
  });

  it('should reject requests if secret is blank', () => {
    assert.equal(verifyGitHubSignature(undefined, payload, ''), false);
  });
});

describe('Store and Topic Routing', () => {
  const testDir = path.join(process.cwd(), 'data_test');
  let store: SettingsStore;

  test.beforeEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    store = new SettingsStore(testDir);
  });

  test.afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should initialize chat settings with sensible defaults', () => {
    const chat = store.getOrCreateChat(-100123456789, 'Engineering Team', true);
    assert.equal(chat.chatId, -100123456789);
    assert.equal(chat.chatTitle, 'Engineering Team');
    assert.equal(chat.isForum, true);
    assert.equal(chat.eventsEnabled.pushes, true);
    assert.equal(chat.eventsEnabled.prs, true);
    assert.equal(chat.eventsEnabled.issues, true);
    assert.equal(chat.eventsEnabled.comments, false);
    assert.equal(chat.verbosity, 'detailed');
    assert.deepEqual(chat.subscribedRepos, []);
  });

  it('should assign and update topic routing for forum topics', () => {
    store.getOrCreateChat(-100123456789, 'Dev Group', true);

    // Assign pushes to topic 42
    store.setTopic(-100123456789, 'pushes', 42, 'Commits');
    let chat = store.getChat(-100123456789)!;
    assert.equal(chat.topics.pushes, 42);
    assert.equal(chat.topicNames['42'], 'Commits');

    // Assign PRs to topic 88
    store.setTopic(-100123456789, 'prs', 88, 'Pull Requests');
    chat = store.getChat(-100123456789)!;
    assert.equal(chat.topics.prs, 88);

    // Unset pushes
    store.unsetTopic(-100123456789, 'pushes');
    chat = store.getChat(-100123456789)!;
    assert.equal(chat.topics.pushes, undefined);
  });

  it('should manage repository subscriptions', () => {
    store.getOrCreateChat(-100123456789, 'Dev Group');

    // Subscribe to a specific repo
    const added = store.subscribeRepo(-100123456789, 'facebook/react');
    assert.equal(added, true);

    const chats = store.getChatsForRepo('facebook/react');
    assert.equal(chats.length, 1);
    assert.equal(chats[0].chatId, -100123456789);
    assert.equal(store.getChatsForRepo('other/private').length, 0);

    // Unsubscribe
    const removed = store.unsubscribeRepo(-100123456789, 'facebook/react');
    assert.equal(removed, true);
    const chatsAfter = store.getChatsForRepo('facebook/react');
    assert.equal(chatsAfter.length, 0);
  });

  it('persists delivery records across restarts', () => {
    store.recordDelivery('12345678-1234-1234-1234-123456789abc', -100123456789);
    const reloaded = new SettingsStore(testDir);
    assert.equal(reloaded.wasDelivered('12345678-1234-1234-1234-123456789abc', -100123456789), true);
    assert.equal(reloaded.wasDelivered('12345678-1234-1234-1234-123456789abc', -100999999999), false);
  });

  it('removes legacy wildcard subscriptions on load', () => {
    store.getOrCreateChat(-100123456789);
    store.updateChat(-100123456789, { subscribedRepos: ['*', 'my-org/api'] });
    const reloaded = new SettingsStore(testDir);
    assert.deepEqual(reloaded.getChat(-100123456789)?.subscribedRepos, ['my-org/api']);
    assert.equal(reloaded.getChatsForRepo('other/private').length, 0);
  });

  it('should toggle event notifications and verbosity', () => {
    store.getOrCreateChat(-100123456789, 'Dev Group');

    // Toggle comments
    const newState = store.toggleEvent(-100123456789, 'comments');
    assert.equal(newState, true);

    // Verbosity
    store.setVerbosity(-100123456789, 'compact');
    assert.equal(store.getChat(-100123456789)?.verbosity, 'compact');

    // Silent
    const silent = store.toggleSilent(-100123456789);
    assert.equal(silent, true);
  });
});

describe('Message Formatters', () => {
  it('should format push events with commits and links', () => {
    const pushPayload: any = {
      ref: 'refs/heads/main',
      before: '000000',
      after: '111111',
      created: false,
      deleted: false,
      forced: false,
      compare: 'https://github.com/myorg/myrepo/compare/000000...111111',
      repository: {
        full_name: 'myorg/myrepo',
        html_url: 'https://github.com/myorg/myrepo',
      },
      pusher: { name: 'alice' },
      sender: { login: 'alice' },
      commits: [
        {
          id: '1a2b3c4d5e6f7a8b9c0d',
          message: 'feat: add telegram notification support',
          url: 'https://github.com/myorg/myrepo/commit/1a2b3c4d5e6f7a8b9c0d',
          author: { name: 'Alice Smith', username: 'alice' },
        },
      ],
    };

    const formatted = formatPushEvent(pushPayload, 'detailed');
    assert.match(formatted, /myorg\/myrepo/);
    assert.match(formatted, /main/);
    assert.match(formatted, /<b>1<\/b> new commit/);
    assert.match(formatted, /1a2b3c4/);
    assert.match(formatted, /feat: add telegram notification support/);
    assert.match(formatted, /Compare changes/);
  });

  it('should format pull request opened and merged', () => {
    const prOpenedPayload: any = {
      action: 'opened',
      repository: {
        full_name: 'myorg/myrepo',
        html_url: 'https://github.com/myorg/myrepo',
      },
      sender: { login: 'bob' },
      pull_request: {
        number: 101,
        title: 'Fix issue with topic router',
        html_url: 'https://github.com/myorg/myrepo/pull/101',
        head: { ref: 'fix/topic-router' },
        base: { ref: 'main' },
        additions: 45,
        deletions: 12,
        changed_files: 3,
        body: 'This PR fixes the topic routing edge case when threadId is 0.',
      },
    };

    const formatted = formatPullRequestEvent(prOpenedPayload);
    assert.match(formatted, /Pull Request #101 opened/);
    assert.match(formatted, /Fix issue with topic router/);
    assert.match(formatted, /fix\/topic-router/);
    assert.match(formatted, /\+45 \/ -12/);
    assert.match(formatted, /https:\/\/github\.com\/myorg\/myrepo\/pull\/101/);
  });

  it('should format issue opened and closed', () => {
    const issuePayload: any = {
      action: 'opened',
      repository: {
        full_name: 'myorg/myrepo',
        html_url: 'https://github.com/myorg/myrepo',
      },
      sender: { login: 'charlie' },
      issue: {
        number: 42,
        title: 'Crash when webhook secret is missing',
        html_url: 'https://github.com/myorg/myrepo/issues/42',
        labels: [{ name: 'bug' }],
        body: 'Please make sure optional webhook secret is handled gracefully.',
      },
    };

    const formatted = formatIssueEvent(issuePayload);
    assert.match(formatted, /Issue #42 opened/);
    assert.match(formatted, /Crash when webhook secret is missing/);
    assert.match(formatted, /bug/);
  });

  it('should format release published', () => {
    const releasePayload: any = {
      action: 'published',
      repository: {
        full_name: 'myorg/myrepo',
        html_url: 'https://github.com/myorg/myrepo',
      },
      sender: { login: 'alice' },
      release: {
        tag_name: 'v1.0.0',
        name: 'Release 1.0.0 Stable',
        html_url: 'https://github.com/myorg/myrepo/releases/tag/v1.0.0',
        prerelease: false,
        body: 'Initial production release with full topic routing.',
      },
    };

    const formatted = formatReleaseEvent(releasePayload);
    assert.match(formatted, /Release published/);
    assert.match(formatted, /v1\.0\.0/);
    assert.match(formatted, /Release 1\.0\.0 Stable/);
  });

  it('should format completed workflow run', () => {
    const workflowPayload: any = {
      action: 'completed',
      repository: {
        full_name: 'myorg/myrepo',
        html_url: 'https://github.com/myorg/myrepo',
      },
      sender: { login: 'github-actions[bot]' },
      workflow: { name: 'CI Pipeline' },
      workflow_run: {
        name: 'CI Pipeline',
        head_branch: 'main',
        head_sha: 'abcdef1234567890',
        conclusion: 'success',
        run_number: 84,
        html_url: 'https://github.com/myorg/myrepo/actions/runs/123456',
        actor: { login: 'alice' },
      },
    };

    const formatted = formatWorkflowEvent(workflowPayload);
    assert.ok(formatted);
    assert.match(formatted, /Workflow succeeded/);
    assert.match(formatted, /CI Pipeline/);
    assert.match(formatted, /main/);
    assert.match(formatted, /Run #84/);
  });
});

describe('Event Dispatcher', () => {
  it('should dispatch push event to pushes topic category', () => {
    const dispatched = parseAndDispatchGitHubEvent('push', {
      ref: 'refs/heads/main',
      repository: { full_name: 'myorg/myrepo' },
      commits: [],
      pusher: { name: 'alice' },
      sender: { login: 'alice' },
    });

    assert.ok(dispatched);
    assert.equal(dispatched.eventType, 'pushes');
    assert.equal(dispatched.repoFullName, 'myorg/myrepo');
    assert.equal(dispatched.branchName, 'main');
  });

  it('should dispatch pull request event to prs topic category', () => {
    const dispatched = parseAndDispatchGitHubEvent('pull_request', {
      action: 'opened',
      repository: { full_name: 'myorg/myrepo' },
      sender: { login: 'bob' },
      pull_request: { number: 1, title: 'Test PR', head: { ref: 'feat' }, base: { ref: 'main' } },
    });

    assert.ok(dispatched);
    assert.equal(dispatched.eventType, 'prs');
  });
});
