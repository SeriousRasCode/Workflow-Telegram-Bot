import { GitHubReleaseEvent } from '../../types/github.js';
import { escapeHtml, truncate } from '../../bot/utils.js';

export function formatReleaseEvent(event: GitHubReleaseEvent): string {
  const rel = event.release;
  const repoName = escapeHtml(event.repository.full_name);
  const repoUrl = event.repository.html_url;
  const tagName = escapeHtml(rel.tag_name);
  const releaseName = escapeHtml(rel.name || rel.tag_name);
  const releaseUrl = rel.html_url;
  const author = escapeHtml(event.sender.login);

  let badge = '🚀';
  let type = 'Release published';

  if (rel.prerelease) {
    badge = '🧪';
    type = 'Pre-release published';
  } else if (event.action === 'created') {
    badge = '🏷️';
    type = 'Release created';
  }

  let message = `${badge} <a href="${repoUrl}"><b>${repoName}</b></a>\n`;
  message += `<b>${type}</b> by <b>${author}</b>\n\n`;
  message += `<b>Tag:</b> <code>${tagName}</code>\n`;
  message += `<b>Name:</b> <a href="${releaseUrl}">${releaseName}</a>\n`;

  if (rel.body) {
    const notes = truncate(rel.body.trim(), 250);
    if (notes) {
      message += `\n<b>Release Notes:</b>\n<blockquote>${escapeHtml(notes)}</blockquote>\n`;
    }
  }

  message += `\n🔗 <a href="${releaseUrl}">View Release on GitHub</a>`;
  return message;
}
