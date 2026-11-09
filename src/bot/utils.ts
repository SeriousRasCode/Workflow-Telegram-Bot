import { Context } from 'grammy';

/**
 * Escapes characters for Telegram HTML mode:
 * & -> &amp;
 * < -> &lt;
 * > -> &gt;
 */
export function escapeHtml(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Formats a short commit hash (first 7 characters).
 */
export function shortSha(sha: string): string {
  return sha ? sha.substring(0, 7) : '';
}

/**
 * Truncates a string to maxLength with an ellipsis.
 */
export function truncate(text: string | null | undefined, maxLength: number): string {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

/**
 * Formats the branch name from a ref string (e.g., "refs/heads/feature/xyz" -> "feature/xyz").
 */
export function formatBranch(ref: string): string {
  if (ref.startsWith('refs/heads/')) {
    return ref.replace('refs/heads/', '');
  }
  if (ref.startsWith('refs/tags/')) {
    return ref.replace('refs/tags/', '');
  }
  return ref;
}

/**
 * Checks if the user who triggered a command or callback is a chat admin.
 */
export async function isChatAdmin(ctx: Context): Promise<boolean> {
  if (ctx.chat?.type === 'private') {
    return true;
  }
  if (!ctx.from) {
    return false;
  }
  try {
    const member = await ctx.getChatMember(ctx.from.id);
    return member.status === 'creator' || member.status === 'administrator';
  } catch (err) {
    console.error('Error checking admin status:', err);
    return false;
  }
}
