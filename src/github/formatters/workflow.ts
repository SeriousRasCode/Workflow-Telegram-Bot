import { GitHubWorkflowRunEvent } from '../../types/github.js';
import { escapeHtml, shortSha } from '../../bot/utils.js';

export function formatWorkflowEvent(event: GitHubWorkflowRunEvent): string | null {
  // We only notify on completed workflow runs to avoid spam
  if (event.action !== 'completed') {
    return null;
  }

  const run = event.workflow_run;
  const repoName = escapeHtml(event.repository.full_name);
  const repoUrl = event.repository.html_url;
  const workflowName = escapeHtml(run.name || event.workflow.name);
  const branch = escapeHtml(run.head_branch);
  const sha = shortSha(run.head_sha);
  const conclusion = run.conclusion;
  const actor = escapeHtml(run.actor ? run.actor.login : event.sender.login);

  let icon = '⚙️';
  let statusText = 'Completed';

  if (conclusion === 'success') {
    icon = '✅';
    statusText = 'Workflow succeeded';
  } else if (conclusion === 'failure') {
    icon = '❌';
    statusText = 'Workflow failed';
  } else if (conclusion === 'cancelled') {
    icon = '⏹️';
    statusText = 'Workflow cancelled';
  } else if (conclusion === 'timed_out') {
    icon = '⏱️';
    statusText = 'Workflow timed out';
  } else {
    statusText = `Workflow finished (${conclusion || 'unknown'})`;
  }

  let message = `${icon} <a href="${repoUrl}"><b>${repoName}</b></a>\n`;
  message += `<b>${statusText}:</b> <b>${workflowName}</b>\n\n`;
  message += `<b>Branch:</b> <code>${branch}</code> (<code>${sha}</code>)\n`;
  message += `<b>Triggered by:</b> <b>${actor}</b>\n`;
  message += `\n🔗 <a href="${run.html_url}">View Run #${run.run_number} on GitHub</a>`;

  return message;
}
