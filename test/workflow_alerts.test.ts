import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ChatSettings } from '../src/types/store.js';
import type { DispatchedEvent } from '../src/github/dispatcher.js';
import { recordWorkflowAlert, selectWorkflowAlert } from '../src/github/workflow_alerts.js';

const chat = (): ChatSettings => ({
  chatId: 1, chatTitle: 'Team', subscribedRepos: ['acme/api'], topics: {}, topicNames: {},
  eventsEnabled: { pushes: true, prs: true, issues: true, comments: false, releases: true, workflows: true, stars: true, forks: true },
  branchFilter: [], verbosity: 'detailed', workflowAlerts: 'failures', workflowFailures: {},
  silent: false, createdAt: '', updatedAt: '',
});

const event = (conclusion: string): DispatchedEvent => ({
  eventType: 'workflows', repoFullName: 'acme/api', branchName: 'main',
  workflow: { key: 'acme/api\n42\nmain', conclusion, name: 'CI', url: 'https://github.com/acme/api/actions/runs/1' },
  format: () => `Run ${conclusion}`,
});

describe('workflow alert selection', () => {
  it('alerts on failures and sends one recovery after success', () => {
    const settings = chat();
    const failed = selectWorkflowAlert(event('failure'), settings);
    assert.equal(failed?.message, 'Run failure');
    recordWorkflowAlert(settings, failed!);
    assert.equal(selectWorkflowAlert(event('cancelled'), settings), null);
    const recovered = selectWorkflowAlert(event('success'), settings);
    assert.match(recovered!.message, /Workflow recovered/);
    recordWorkflowAlert(settings, recovered!);
    assert.equal(selectWorkflowAlert(event('success'), settings), null);
  });

  it('keeps all-completions behavior and supports timeouts', () => {
    const settings = chat();
    assert.equal(selectWorkflowAlert(event('timed_out'), settings)?.message, 'Run timed_out');
    settings.workflowAlerts = 'all';
    recordWorkflowAlert(settings, selectWorkflowAlert(event('failure'), settings)!);
    const success = selectWorkflowAlert(event('success'), settings);
    assert.equal(success?.message, 'Run success');
    recordWorkflowAlert(settings, success!);
    settings.workflowAlerts = 'failures';
    assert.equal(selectWorkflowAlert(event('success'), settings), null);
  });
});
