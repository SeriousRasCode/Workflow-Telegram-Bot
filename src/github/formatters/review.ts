import type { GitHubPullRequestReviewEvent } from '../../types/github.js';
import { escapeHtml, truncate } from '../../bot/utils.js';

export function formatPullRequestReview(event: GitHubPullRequestReviewEvent): string | null {
  if (event.action !== 'submitted') return null;
  const state = event.review.state;
  const label = state === 'approved' ? 'approved' : state === 'changes_requested' ? 'requested changes on' : state === 'commented' ? 'reviewed' : null;
  if (!label) return null;
  const body = event.review.body?.trim();
  return `🔎 <b>${escapeHtml(event.sender.login)}</b> ${label} pull request\n\n` +
    `<a href="${event.pull_request.html_url}">#${event.pull_request.number} ${escapeHtml(event.pull_request.title)}</a> in ` +
    `<a href="${event.repository.html_url}">${escapeHtml(event.repository.full_name)}</a>` +
    (body ? `\n\n<blockquote>${escapeHtml(truncate(body, 240))}</blockquote>` : '') +
    `\n\n<a href="${event.review.html_url}">View review</a>`;
}
