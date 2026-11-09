import { GitHubPullRequestEvent } from '../../types/github.js';
import { escapeHtml, truncate } from '../../bot/utils.js';

export function formatPullRequestEvent(event: GitHubPullRequestEvent): string {
  const pr = event.pull_request;
  const repoName = escapeHtml(event.repository.full_name);
  const repoUrl = event.repository.html_url;
  const prNumber = pr.number;
  const prUrl = pr.html_url;
  const title = escapeHtml(pr.title);
  const user = escapeHtml(event.sender.login);

  let icon = '🔀';
  let actionText = `PR #${prNumber}`;

  if (event.action === 'opened') {
    icon = '🆕 🔀';
    actionText = `Pull Request #${prNumber} opened`;
  } else if (event.action === 'closed') {
    if (pr.merged) {
      icon = '🟣';
      actionText = `Pull Request #${prNumber} merged`;
    } else {
      icon = '🔴';
      actionText = `Pull Request #${prNumber} closed without merging`;
    }
  } else if (event.action === 'reopened') {
    icon = '🟢 🔀';
    actionText = `Pull Request #${prNumber} reopened`;
  } else if (event.action === 'ready_for_review') {
    icon = '📋 🔀';
    actionText = `Pull Request #${prNumber} marked ready for review`;
  } else if (event.action === 'review_requested') {
    icon = '👀 🔀';
    actionText = `Review requested on Pull Request #${prNumber}`;
  } else {
    actionText = `Pull Request #${prNumber} ${event.action}`;
  }

  const baseBranch = escapeHtml(pr.base.ref);
  const headBranch = escapeHtml(pr.head.ref);

  let message = `${icon} <a href="${repoUrl}"><b>${repoName}</b></a>\n`;
  message += `<b>${actionText}</b> by <b>${user}</b>\n\n`;
  message += `<b>Title:</b> <a href="${prUrl}">${title}</a>\n`;
  message += `<b>Branches:</b> <code>${headBranch}</code> ➔ <code>${baseBranch}</code>\n`;

  if (pr.changed_files !== undefined) {
    message += `<b>Changes:</b> +${pr.additions || 0} / -${pr.deletions || 0} (${pr.changed_files} ${pr.changed_files === 1 ? 'file' : 'files'})\n`;
  }

  if (pr.body && (event.action === 'opened' || event.action === 'reopened')) {
    const preview = truncate(pr.body.trim(), 200);
    if (preview) {
      message += `\n<blockquote>${escapeHtml(preview)}</blockquote>\n`;
    }
  }

  message += `\n🔗 <a href="${prUrl}">View Pull Request on GitHub</a>`;
  return message;
}
