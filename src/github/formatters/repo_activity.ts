import { GitHubStarEvent, GitHubForkEvent, GitHubPingEvent } from '../../types/github.js';
import { escapeHtml } from '../../bot/utils.js';

export function formatStarEvent(event: GitHubStarEvent): string | null {
  if (event.action !== 'created') {
    return null; // Don't notify on unstar
  }
  const repoName = escapeHtml(event.repository.full_name);
  const repoUrl = event.repository.html_url;
  const user = escapeHtml(event.sender.login);
  const userUrl = event.sender.html_url;

  return `⭐ <a href="${repoUrl}"><b>${repoName}</b></a> was starred by <a href="${userUrl}"><b>${user}</b></a>!`;
}

export function formatForkEvent(event: GitHubForkEvent): string {
  const repoName = escapeHtml(event.repository.full_name);
  const repoUrl = event.repository.html_url;
  const forkeeName = escapeHtml(event.forkee.full_name);
  const forkeeUrl = event.forkee.html_url;
  const user = escapeHtml(event.sender.login);

  return `🍴 <a href="${repoUrl}"><b>${repoName}</b></a> was forked by <b>${user}</b> to <a href="${forkeeUrl}"><b>${forkeeName}</b></a>`;
}

export function formatPingEvent(event: GitHubPingEvent): string {
  const repoName = event.repository ? escapeHtml(event.repository.full_name) : 'GitHub Webhook';
  const zen = escapeHtml(event.zen);
  return `🔔 <b>Webhook Connected!</b>\n<b>Repository:</b> <code>${repoName}</code>\n<b>Zen:</b> <i>"${zen}"</i>\n\nYour GitHub webhook is properly connected and active!`;
}
