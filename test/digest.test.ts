import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ChatSettings } from '../src/types/store.js';
import { digestDue, digestItem, digestMessages, isQuiet, shouldQueueDigest, validTime, validTimeZone } from '../src/bot/digest.js';

const chat = (): ChatSettings => ({
  chatId: 1, chatTitle: 'Team', subscribedRepos: [], topics: {}, topicNames: {},
  eventsEnabled: { pushes: true, prs: true, issues: true, comments: false, releases: true, workflows: false, stars: true, forks: true },
  branchFilter: [], verbosity: 'detailed', silent: false, createdAt: '', updatedAt: '',
});

describe('quiet hours and digests', () => {
  it('validates times and IANA zones', () => {
    assert.equal(validTime('23:59'), true);
    assert.equal(validTime('24:00'), false);
    assert.equal(validTimeZone('Africa/Nairobi'), true);
    assert.equal(validTimeZone('Mars/Olympus'), false);
  });

  it('handles overnight quiet hours in the chat timezone', () => {
    const settings = chat();
    settings.quietHours = { start: '22:00', end: '08:00', timeZone: 'Africa/Nairobi' };
    assert.equal(isQuiet(settings, new Date('2026-11-11T20:00:00Z')), true);
    assert.equal(isQuiet(settings, new Date('2026-11-12T04:59:00Z')), true);
    assert.equal(isQuiet(settings, new Date('2026-11-12T05:00:00Z')), false);
    assert.equal(shouldQueueDigest(settings, true, new Date('2026-11-11T20:00:00Z')), false);
    assert.equal(shouldQueueDigest(settings, false, new Date('2026-11-11T20:00:00Z')), true);
  });

  it('sends a daily digest only once after its configured time', () => {
    const settings = chat();
    settings.dailyDigest = { time: '09:00', timeZone: 'Africa/Nairobi' };
    const now = new Date('2026-11-11T06:01:00Z');
    assert.deepEqual(digestDue(settings, now), { due: true, date: '2026-11-11' });
    settings.lastDigestDate = '2026-11-11';
    assert.equal(digestDue(settings, now).due, false);
  });

  it('escapes event summaries and splits large digests', () => {
    const item = digestItem('a/<repo>', '<b>Push</b> &amp; <code>main</code>');
    assert.match(item, /a\/&lt;repo&gt;/);
    assert.match(item, /Push &amp; main/);
    const chunks = digestMessages(Array.from({ length: 50 }, () => item.repeat(5)));
    assert.ok(chunks.length > 1);
    assert.equal(chunks.reduce((sum, chunk) => sum + chunk.count, 0), 50);
    assert.ok(chunks.every(chunk => chunk.text.length <= 3500));
  });
});
