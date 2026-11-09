import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildMenu, repoKey } from '../src/worker/menu.js';
import type { ChatSettings } from '../src/types/store.js';

const chat: ChatSettings = {
  chatId: -1004436503021, chatTitle: 'Engineering <Team>', subscribedRepos: ['seriousrascode/workflow-telegram-bot'],
  topics: {}, topicNames: {}, eventsEnabled: { pushes: true, prs: true, issues: true, comments: false,
    releases: true, workflows: false, stars: true, forks: true }, branchFilter: [], verbosity: 'detailed', silent: false,
  createdAt: '', updatedAt: '',
};

describe('Telegram inline menus', () => {
  it('shows current event states and uses short callback data', () => {
    const menu = buildMenu('events', chat, []);
    const buttons = menu.reply_markup.inline_keyboard.flat();
    assert.ok(buttons.some(button => 'callback_data' in button && button.callback_data.endsWith(':event:pushes') && button.text.includes('✅')));
    assert.ok(buttons.some(button => 'callback_data' in button && button.callback_data.endsWith(':event:comments') && button.text.includes('❌')));
    assert.ok(buttons.every(button => !('callback_data' in button) || Buffer.byteLength(button.callback_data) <= 64));
  });

  it('escapes chat names and binds repository removal to its current value', () => {
    const home = buildMenu('home', chat, []);
    const repos = buildMenu('repos', chat, []);
    assert.match(home.text, /Engineering &lt;Team&gt;/);
    assert.ok(repos.reply_markup.inline_keyboard.flat().some(button =>
      'callback_data' in button && button.callback_data.endsWith(`:unsub:0:${repoKey(chat.subscribedRepos[0])}`)));
  });

  it('offers topic assignment only inside a topic', () => {
    const outside = buildMenu('topics', chat, []);
    const inside = buildMenu('topics', chat, [], 42);
    assert.ok(!outside.reply_markup.inline_keyboard.flat().some(button => 'callback_data' in button && button.callback_data.includes(':topic:42:')));
    assert.ok(inside.reply_markup.inline_keyboard.flat().some(button => 'callback_data' in button && button.callback_data.endsWith(':topic:42:pushes')));
  });

  it('offers one-tap follow for a connected repository', () => {
    const empty = { ...chat, subscribedRepos: [] };
    const menu = buildMenu('connections', empty, [{ owner: 'acme/api', verified: 1 }]);
    assert.ok(menu.reply_markup.inline_keyboard.flat().some(button =>
      'callback_data' in button && button.callback_data.endsWith(`:sub:0:${repoKey('acme/api')}`)));
  });
});
