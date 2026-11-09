import { GitHubIssueCommentEvent } from '../../types/github.js';
import { escapeHtml, truncate } from '../../bot/utils.js';

export function formatCommentEvent(event: GitHubIssueCommentEvent): string {
  const isPR = Boolean(event.issue.pull_request);
  const typeLabel = isPR ? 'Pull Request' : 'Issue';
  const repoName = escapeHtml(event.repository.full_name);
  const repoUrl = event.repository.html_url;
  const number = event.issue.number;
  const targetTitle = escapeHtml(event.issue.title);
  const author = escapeHtml(event.comment.user.login);
  const commentUrl = event.comment.html_url;

  let message = `💬 <a href="${repoUrl}"><b>${repoName}</b></a>\n`;
  message += `<b>New comment on ${typeLabel} #${number}</b> by <b>${author}</b>\n\n`;
  message += `<b>Target:</b> <a href="${event.issue.html_url}">${targetTitle}</a>\n`;

  const bodySnippet = truncate(event.comment.body.trim(), 200);
  if (bodySnippet) {
    message += `\n<blockquote>${escapeHtml(bodySnippet)}</blockquote>\n`;
  }

  message += `\n🔗 <a href="${commentUrl}">View Comment on GitHub</a>`;
  return message;
}
