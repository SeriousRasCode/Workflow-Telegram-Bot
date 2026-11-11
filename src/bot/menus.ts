import { InlineKeyboard } from 'grammy';
import { store } from '../storage/store.js';
import { ChatSettings, EventType } from '../types/store.js';
import { escapeHtml } from './utils.js';

export function buildSettingsText(chat: ChatSettings): string {
  let text = `⚙️ <b>GitHub Bot Settings for "${escapeHtml(chat.chatTitle)}"</b>\n\n`;

  // Subscribed Repositories
  text += `📦 <b>Subscribed Repositories:</b>\n`;
  if (chat.subscribedRepos.length === 0) {
    text += `  <i>None (run /subscribe &lt;owner/repo&gt;)</i>\n`;
  } else {
    for (const repo of chat.subscribedRepos) {
      text += `  • <code>${escapeHtml(repo)}</code>\n`;
    }
  }
  text += `\n`;

  // Topic Routing
  text += `🏷️ <b>Topic Routing Table:</b>\n`;
  const formatTopic = (threadId?: number | null) => {
    if (threadId === undefined || threadId === null) return '<i>General / Chat default</i>';
    const name = chat.topicNames?.[threadId.toString()];
    return name ? `<b>${escapeHtml(name)}</b> (<code>ID: ${threadId}</code>)` : `<code>Topic ID: ${threadId}</code>`;
  };

  text += `  • <b>All Events Default:</b> ${formatTopic(chat.topics.all)}\n`;
  text += `  • 🔨 <b>Pushes:</b> ${formatTopic(chat.topics.pushes)}\n`;
  text += `  • 🔀 <b>Pull Requests:</b> ${formatTopic(chat.topics.prs)}\n`;
  text += `  • ⚠️ <b>Issues:</b> ${formatTopic(chat.topics.issues)}\n`;
  text += `  • 💬 <b>Comments:</b> ${formatTopic(chat.topics.comments)}\n`;
  text += `  • 🚀 <b>Releases:</b> ${formatTopic(chat.topics.releases)}\n`;
  text += `  • ⚙️ <b>Workflows:</b> ${formatTopic(chat.topics.workflows)}\n`;
  text += `  • ⭐ <b>Stars & Forks:</b> ${formatTopic(chat.topics.stars)}\n`;
  text += `\n`;

  // Enabled Events
  text += `🔔 <b>Enabled Notifications:</b>\n`;
  text += `  ${chat.eventsEnabled.pushes ? '✅' : '❌'} Pushes  `;
  text += `  ${chat.eventsEnabled.prs ? '✅' : '❌'} PRs  `;
  text += `  ${chat.eventsEnabled.issues ? '✅' : '❌'} Issues  `;
  text += `  ${chat.eventsEnabled.releases ? '✅' : '❌'} Releases\n`;
  text += `  ${chat.eventsEnabled.comments ? '✅' : '❌'} Comments  `;
  text += `  ${chat.eventsEnabled.workflows ? '✅' : '❌'} Workflows  `;
  text += `  ${chat.eventsEnabled.stars ? '✅' : '❌'} Stars  `;
  text += `  ${chat.eventsEnabled.forks ? '✅' : '❌'} Forks\n`;
  text += `\n`;

  // Branch filter & verbosity
  text += `🌿 <b>Branch Filter:</b> ${chat.branchFilter.length > 0 ? chat.branchFilter.map((b) => `<code>${escapeHtml(b)}</code>`).join(', ') : '<i>All branches</i>'}\n`;
  text += `📝 <b>Verbosity:</b> <code>${chat.verbosity}</code>\n`;
  text += `⚙️ <b>Workflow alerts:</b> <code>${chat.workflowAlerts === 'failures' ? 'failures and recovery' : 'all completions'}</code>\n`;
  text += `🌙 <b>Quiet hours:</b> ${chat.quietHours ? `<code>${escapeHtml(chat.quietHours.start)}–${escapeHtml(chat.quietHours.end)} ${escapeHtml(chat.quietHours.timeZone)}</code>` : 'Off'}\n`;
  text += `📬 <b>Daily digest:</b> ${chat.dailyDigest ? `<code>${escapeHtml(chat.dailyDigest.time)} ${escapeHtml(chat.dailyDigest.timeZone)}</code>` : 'Off'}\n`;
  text += `🔕 <b>Silent Notifications:</b> ${chat.silent ? '<b>Yes</b>' : '<b>No</b>'}\n`;

  return text;
}

export function buildMainMenuKeyboard(chat: ChatSettings, currentThreadId?: number): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  if (currentThreadId !== undefined) {
    // User opened menu from inside a specific topic!
    keyboard
      .text(`🎯 Assign This Topic (#${currentThreadId})`, `menu:assign_topic:${currentThreadId}`)
      .row();
  }

  keyboard
    .text('🔔 Toggle Events', 'menu:events')
    .text('📝 Verbosity', 'menu:verbosity')
    .row()
    .text(`⚙️ CI: ${chat.workflowAlerts === 'failures' ? 'Failures' : 'All runs'}`, 'menu:workflow')
    .row()
    .text(chat.silent ? '🔔 Unmute Bot' : '🔕 Mute Bot (Silent)', 'menu:toggle_silent')
    .text('🗑️ Clear Topic Routes', 'menu:clear_topics')
    .row()
    .text('🔄 Refresh Status', 'menu:refresh');

  return keyboard;
}

export function buildEventsMenuKeyboard(chat: ChatSettings): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const e = chat.eventsEnabled;

  keyboard
    .text(`${e.pushes ? '✅' : '❌'} Pushes`, 'toggle_event:pushes')
    .text(`${e.prs ? '✅' : '❌'} Pull Requests`, 'toggle_event:prs')
    .row()
    .text(`${e.issues ? '✅' : '❌'} Issues`, 'toggle_event:issues')
    .text(`${e.comments ? '✅' : '❌'} Comments`, 'toggle_event:comments')
    .row()
    .text(`${e.releases ? '✅' : '❌'} Releases`, 'toggle_event:releases')
    .text(`${e.workflows ? '✅' : '❌'} Workflows`, 'toggle_event:workflows')
    .row()
    .text(`${e.stars ? '✅' : '❌'} Stars`, 'toggle_event:stars')
    .text(`${e.forks ? '✅' : '❌'} Forks`, 'toggle_event:forks')
    .row()
    .text('« Back to Settings', 'menu:main');

  return keyboard;
}

export function buildAssignTopicKeyboard(threadId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text('🌐 All Events', `assign_thread:${threadId}:all`)
    .text('🔨 Pushes', `assign_thread:${threadId}:pushes`)
    .row()
    .text('🔀 Pull Requests', `assign_thread:${threadId}:prs`)
    .text('⚠️ Issues', `assign_thread:${threadId}:issues`)
    .row()
    .text('🚀 Releases', `assign_thread:${threadId}:releases`)
    .text('⚙️ Workflows', `assign_thread:${threadId}:workflows`)
    .row()
    .text('💬 Comments', `assign_thread:${threadId}:comments`)
    .text('⭐ Stars/Forks', `assign_thread:${threadId}:stars`)
    .row()
    .text('« Cancel', 'menu:main');
}
