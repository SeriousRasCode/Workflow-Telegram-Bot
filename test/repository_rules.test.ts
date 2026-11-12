import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ChatSettings } from '../src/types/store.js';
import { effectiveSettings, setRepositoryBranches, setRepositoryEvent, setRepositoryTopic } from '../src/bot/repository_rules.js';

const chat = (): ChatSettings => ({
  chatId: 1, chatTitle: 'Team', subscribedRepos: ['acme/api'], topics: { all: 10, pushes: 20 }, topicNames: {},
  eventsEnabled: { pushes: true, prs: true, reviews: false, issues: true, comments: false, releases: true, workflows: false, stars: true, forks: true },
  branchFilter: ['main'], verbosity: 'detailed', silent: false, createdAt: '', updatedAt: '',
});

describe('repository rules', () => {
  it('overrides only the selected repository and leaves chat defaults intact', () => {
    const settings = chat();
    setRepositoryEvent(settings, 'Acme/API', 'pushes', 'off');
    setRepositoryBranches(settings, 'acme/api', ['release/*']);
    setRepositoryTopic(settings, 'acme/api', 'all', 30);
    const effective = effectiveSettings(settings, 'ACME/api');
    assert.equal(effective.eventsEnabled.pushes, false);
    assert.deepEqual(effective.branchFilter, ['release/*']);
    assert.equal(effective.topics.pushes, 30);
    assert.equal(settings.topics.pushes, 20);
    assert.equal(effectiveSettings(settings, 'acme/other').eventsEnabled.pushes, true);
  });

  it('supports specific topics, general routing, and inheritance', () => {
    const settings = chat();
    setRepositoryTopic(settings, 'acme/api', 'all', 30);
    setRepositoryTopic(settings, 'acme/api', 'pushes', null);
    assert.equal(effectiveSettings(settings, 'acme/api').topics.pushes, null);
    setRepositoryTopic(settings, 'acme/api', 'pushes', undefined);
    assert.equal(effectiveSettings(settings, 'acme/api').topics.pushes, 30);
    setRepositoryTopic(settings, 'acme/api', 'all', undefined);
    assert.equal(effectiveSettings(settings, 'acme/api').topics.pushes, 20);
    setRepositoryBranches(settings, 'acme/api', []);
    assert.deepEqual(effectiveSettings(settings, 'acme/api').branchFilter, []);
    setRepositoryBranches(settings, 'acme/api', undefined);
    assert.deepEqual(effectiveSettings(settings, 'acme/api').branchFilter, ['main']);
    setRepositoryEvent(settings, 'acme/api', 'pushes', 'off');
    setRepositoryEvent(settings, 'acme/api', 'pushes', 'inherit');
    assert.equal(effectiveSettings(settings, 'acme/api').eventsEnabled.pushes, true);
  });
});
