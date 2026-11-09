import { GitHubIssuesEvent } from '../../types/github.js';
import { escapeHtml, truncate } from '../../bot/utils.js';

export function formatIssueEvent(event: GitHubIssuesEvent): string {
  const issue = event.issue;
  const repoName = escapeHtml(event.repository.full_name);
  const repoUrl = event.repository.html_url;
  const issueNumber = issue.number;
  const issueUrl = issue.html_url;
  const title = escapeHtml(issue.title);
  const sender = escapeHtml(event.sender.login);

  let icon = '📌';
  let actionText = `Issue #${issueNumber}`;

  if (event.action === 'opened') {
    icon = '⚠️';
    actionText = `Issue #${issueNumber} opened`;
  } else if (event.action === 'closed') {
    icon = '✅';
    actionText = `Issue #${issueNumber} closed`;
  } else if (event.action === 'reopened') {
    icon = '🔄';
    actionText = `Issue #${issueNumber} reopened`;
  } else if (event.action === 'assigned') {
    const assignee = issue.assignee ? escapeHtml(issue.assignee.login) : 'someone';
    icon = '👤';
    actionText = `Issue #${issueNumber} assigned to ${assignee}`;
  } else if (event.action === 'labeled') {
    icon = '🏷️';
    actionText = `Issue #${issueNumber} labeled`;
  } else {
    actionText = `Issue #${issueNumber} ${event.action}`;
  }

  let message = `${icon} <a href="${repoUrl}"><b>${repoName}</b></a>\n`;
  message += `<b>${actionText}</b> by <b>${sender}</b>\n\n`;
  message += `<b>Title:</b> <a href="${issueUrl}">${title}</a>\n`;

  if (issue.labels && issue.labels.length > 0) {
    const labelsStr = issue.labels.map((l) => `<code>${escapeHtml(l.name)}</code>`).join(' ');
    message += `<b>Labels:</b> ${labelsStr}\n`;
  }

  if (issue.body && (event.action === 'opened' || event.action === 'reopened')) {
    const preview = truncate(issue.body.trim(), 200);
    if (preview) {
      message += `\n<blockquote>${escapeHtml(preview)}</blockquote>\n`;
    }
  }

  message += `\n🔗 <a href="${issueUrl}">View Issue on GitHub</a>`;
  return message;
}
