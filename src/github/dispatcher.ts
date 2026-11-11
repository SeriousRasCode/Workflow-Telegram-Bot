import { EventType } from '../types/store.js';
import { formatPushEvent } from './formatters/push.js';
import { formatPullRequestEvent } from './formatters/pull_request.js';
import { formatIssueEvent } from './formatters/issue.js';
import { formatCommentEvent } from './formatters/comment.js';
import { formatReleaseEvent } from './formatters/release.js';
import { formatWorkflowEvent } from './formatters/workflow.js';
import { formatStarEvent, formatForkEvent, formatPingEvent } from './formatters/repo_activity.js';
import { formatBranch } from '../bot/utils.js';

export interface DispatchedEvent {
  eventType: EventType;
  repoFullName: string;
  branchName?: string;
  workflow?: { key: string; conclusion: string | null; name: string; url: string };
  format: (verbosity: 'compact' | 'detailed') => string | null;
}

export function parseAndDispatchGitHubEvent(
  eventName: string,
  payload: any
): DispatchedEvent | null {
  const repoFullName: string = payload.repository?.full_name || '';

  switch (eventName) {
    case 'push': {
      const branchName = payload.ref ? formatBranch(payload.ref) : undefined;
      return {
        eventType: 'pushes',
        repoFullName,
        branchName,
        format: (verbosity) => formatPushEvent(payload, verbosity),
      };
    }

    case 'pull_request': {
      return {
        eventType: 'prs',
        repoFullName,
        branchName: payload.pull_request?.base?.ref,
        format: () => formatPullRequestEvent(payload),
      };
    }

    case 'issues': {
      return {
        eventType: 'issues',
        repoFullName,
        format: () => formatIssueEvent(payload),
      };
    }

    case 'issue_comment': {
      return {
        eventType: 'comments',
        repoFullName,
        format: () => formatCommentEvent(payload),
      };
    }

    case 'release': {
      return {
        eventType: 'releases',
        repoFullName,
        format: () => formatReleaseEvent(payload),
      };
    }

    case 'workflow_run': {
      const run = payload.workflow_run;
      return {
        eventType: 'workflows',
        repoFullName,
        branchName: run?.head_branch,
        workflow: run && payload.action === 'completed' ? {
          key: `${repoFullName.toLowerCase()}\n${run.workflow_id}\n${run.head_branch || ''}`,
          conclusion: run.conclusion,
          name: run.name || payload.workflow?.name || 'Workflow',
          url: run.html_url,
        } : undefined,
        format: () => formatWorkflowEvent(payload),
      };
    }

    case 'star': {
      return {
        eventType: 'stars',
        repoFullName,
        format: () => formatStarEvent(payload),
      };
    }

    case 'fork': {
      return {
        eventType: 'forks',
        repoFullName,
        format: () => formatForkEvent(payload),
      };
    }

    case 'ping': {
      return {
        eventType: 'all',
        repoFullName,
        format: () => formatPingEvent(payload),
      };
    }

    default:
      return null;
  }
}
