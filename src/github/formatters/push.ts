import { GitHubPushEvent } from '../../types/github.js';
import { escapeHtml, shortSha, truncate, formatBranch } from '../../bot/utils.js';

export function formatPushEvent(event: GitHubPushEvent, verbosity: 'compact' | 'detailed' = 'detailed'): string {
  const repoName = escapeHtml(event.repository.full_name);
  const repoUrl = event.repository.html_url;
  const branch = escapeHtml(formatBranch(event.ref));
  const pusher = escapeHtml(event.pusher.name || event.sender.login);

  if (event.deleted) {
    return `🗑️ <a href="${repoUrl}"><b>${repoName}</b></a>: Branch <code>${branch}</code> deleted by <b>${pusher}</b>`;
  }

  if (event.created && (!event.commits || event.commits.length === 0)) {
    return `🌱 <a href="${repoUrl}"><b>${repoName}</b></a>: New branch <a href="${event.repository.html_url}/tree/${branch}"><code>${branch}</code></a> created by <b>${pusher}</b>`;
  }

  const commitCount = event.commits ? event.commits.length : 0;
  const commitWord = commitCount === 1 ? 'commit' : 'commits';
  const forceTag = event.forced ? ' <i>(force pushed)</i>' : '';

  let message = `🔨 <a href="${repoUrl}"><b>${repoName}</b></a>: <b>${commitCount}</b> new ${commitWord} to <a href="${event.repository.html_url}/tree/${branch}"><code>${branch}</code></a> by <b>${pusher}</b>${forceTag}\n\n`;

  if (verbosity === 'detailed' && event.commits && event.commits.length > 0) {
    // Show up to 5 commits directly to keep message neat and informative
    const displayCommits = event.commits.slice(0, 5);
    for (const commit of displayCommits) {
      const sha = shortSha(commit.id);
      const firstLine = truncate(commit.message.split('\n')[0], 70);
      const author = escapeHtml(commit.author.username || commit.author.name);
      message += `• <a href="${commit.url}"><code>${sha}</code></a> ${escapeHtml(firstLine)} <i>(${author})</i>\n`;
    }

    if (event.commits.length > 5) {
      const remaining = event.commits.length - 5;
      message += `<i>...and ${remaining} more commit${remaining === 1 ? '' : 's'}</i>\n`;
    }
    message += '\n';
  }

  if (event.compare) {
    message += `🔍 <a href="${event.compare}">Compare changes</a>`;
  }

  return message.trim();
}
