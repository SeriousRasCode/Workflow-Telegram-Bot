import { Bot, Context } from 'grammy';
import { store } from '../storage/store.js';
import { config } from '../config.js';
import { EventType } from '../types/store.js';
import { isChatAdmin, escapeHtml } from './utils.js';
import {
  buildSettingsText,
  buildMainMenuKeyboard,
  buildEventsMenuKeyboard,
  buildAssignTopicKeyboard,
} from './menus.js';

export function registerBotCommands(bot: Bot): void {
  // /start command
  bot.command('start', async (ctx) => {
    const chat = store.getOrCreateChat(
      ctx.chat.id,
      ctx.chat.title || ctx.from?.first_name || 'Direct Chat',
      Boolean(ctx.chat.is_forum)
    );

    let welcome = `👋 <b>Hello! I am your GitHub Workflow Bot.</b>\n\n`;
    welcome += `I deliver real-time GitHub notifications (pushes, pull requests, issues, releases, actions, and stars) directly to your Telegram chats with <b>full Forum Topics support</b>!\n\n`;
    welcome += `<b>Quick Setup:</b>\n`;
    welcome += `1. Add me to your group (make sure I have permission to post messages).\n`;
    welcome += `2. If your group has Topics enabled, go to the topic you want notifications in and send:\n`;
    welcome += `   • <code>/set_topic all</code> (for all events)\n`;
    welcome += `   • or <code>/set_topic pushes</code>, <code>/set_topic prs</code>, <code>/set_topic issues</code>\n`;
    welcome += `3. Configure your GitHub webhook:\n`;
    welcome += `   • Payload URL: <code>${escapeHtml(config.baseUrl)}/webhook</code>\n`;
    welcome += `   • Content type: <code>application/json</code>\n`;
    welcome += `   • Secret: <code>${config.webhookSecret ? '(your configured secret)' : '(none configured)'}</code>\n\n`;
    welcome += `Type /help to see all available commands or /settings for interactive configuration.`;

    await ctx.reply(welcome, { parse_mode: 'HTML' });
  });

  // /help command
  bot.command('help', async (ctx) => {
    let help = `📖 <b>GitHub Bot Commands Reference:</b>\n\n`;
    help += `<b>Topic Assignment (Admins only):</b>\n`;
    help += `• <code>/set_topic all</code> &mdash; Route all events to this topic\n`;
    help += `• <code>/set_topic &lt;event&gt;</code> &mdash; Route specific event here\n`;
    help += `  <i>Events: pushes, prs, issues, comments, releases, workflows, stars</i>\n`;
    help += `• <code>/unset_topic &lt;event&gt;</code> &mdash; Remove topic routing for an event\n\n`;

    help += `<b>Settings & Interactive Menu:</b>\n`;
    help += `• <code>/settings</code> &mdash; Open interactive settings dashboard\n`;
    help += `• <code>/status</code> &mdash; View current connection & topic routing\n\n`;

    help += `<b>Repository & Filter Management:</b>\n`;
    help += `• <code>/subscribe &lt;owner/repo&gt;</code> &mdash; Subscribe this chat to a repository\n`;
    help += `• <code>/unsubscribe &lt;owner/repo&gt;</code> &mdash; Unsubscribe from a repository\n`;
    help += `• <code>/repos</code> &mdash; List subscribed repositories\n`;
    help += `• <code>/filter_branches &lt;b1&gt; &lt;b2&gt;</code> &mdash; Only notify for specific branches\n`;
    help += `• <code>/filter_branches all</code> &mdash; Notify for all branches\n`;
    help += `• <code>/workflow_alerts &lt;all|failures&gt;</code> &mdash; Choose CI alerts\n`;

    await ctx.reply(help, { parse_mode: 'HTML' });
  });

  // /settings command
  bot.command(['settings', 'config'], async (ctx) => {
    const chat = store.getOrCreateChat(
      ctx.chat.id,
      ctx.chat.title || ctx.from?.first_name || 'Direct Chat',
      Boolean(ctx.chat.is_forum)
    );

    const threadId = ctx.message?.message_thread_id;
    const text = buildSettingsText(chat);
    const keyboard = buildMainMenuKeyboard(chat, threadId);

    await ctx.reply(text, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
      message_thread_id: threadId,
    });
  });

  // /status command
  bot.command('status', async (ctx) => {
    const chat = store.getOrCreateChat(
      ctx.chat.id,
      ctx.chat.title || ctx.from?.first_name || 'Direct Chat',
      Boolean(ctx.chat.is_forum)
    );

    let text = `📊 <b>Bot Status & Routing</b>\n\n`;
    text += `<b>Chat ID:</b> <code>${chat.chatId}</code>\n`;
    text += `<b>Forum Topics Enabled:</b> ${ctx.chat.is_forum ? 'Yes' : 'No'}\n`;
    text += `<b>Webhook URL:</b> <code>${escapeHtml(config.baseUrl)}/webhook</code>\n`;
    text += `<b>Signature Verification:</b> ${config.webhookSecret ? '🔒 Enabled' : '⚠️ Disabled (No Secret)'}\n\n`;
    text += buildSettingsText(chat);

    await ctx.reply(text, {
      parse_mode: 'HTML',
      message_thread_id: ctx.message?.message_thread_id,
    });
  });

  // /set_topic or /settopic command
  bot.command(['set_topic', 'settopic'], async (ctx) => {
    if (!(await isChatAdmin(ctx))) {
      await ctx.reply('⛔ Only chat administrators can configure topic routing.');
      return;
    }

    const args = ctx.message?.text?.split(/\s+/).slice(1) || [];
    const eventArg = args[0]?.toLowerCase() as EventType | undefined;
    const threadId = ctx.message?.message_thread_id;

    if (!eventArg) {
      await ctx.reply(
        `⚠️ <b>Usage:</b> <code>/set_topic &lt;event&gt;</code>\n\n` +
          `Run this command <b>inside the topic</b> you want to assign.\n\n` +
          `<b>Valid events:</b>\n` +
          `• <code>all</code> (All events)\n` +
          `• <code>pushes</code> (Git pushes & commits)\n` +
          `• <code>prs</code> (Pull requests)\n` +
          `• <code>issues</code> (Issues)\n` +
          `• <code>comments</code> (Issue & PR comments)\n` +
          `• <code>releases</code> (Releases & tags)\n` +
          `• <code>workflows</code> (GitHub Actions)\n` +
          `• <code>stars</code> (Stars & forks)`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    const validEvents: EventType[] = [
      'all',
      'pushes',
      'prs',
      'issues',
      'comments',
      'releases',
      'workflows',
      'stars',
      'forks',
    ];

    if (!validEvents.includes(eventArg)) {
      await ctx.reply(
        `❌ Invalid event type <code>${escapeHtml(eventArg)}</code>.\nValid options: ${validEvents.map((e) => `<code>${e}</code>`).join(', ')}`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    const targetThreadId = threadId || null;
    const topicLabel = targetThreadId ? `Topic ID: ${targetThreadId}` : 'General / Main chat';

    store.setTopic(ctx.chat.id, eventArg, targetThreadId, topicLabel);

    await ctx.reply(
      `✅ <b>Topic Assigned!</b>\n\nEvent <b>${eventArg}</b> will now be sent to <b>${topicLabel}</b>.`,
      {
        parse_mode: 'HTML',
        message_thread_id: threadId,
      }
    );
  });

  // /unset_topic or /unsettopic command
  bot.command(['unset_topic', 'unsettopic'], async (ctx) => {
    if (!(await isChatAdmin(ctx))) {
      await ctx.reply('⛔ Only chat administrators can modify topic routing.');
      return;
    }

    const args = ctx.message?.text?.split(/\s+/).slice(1) || [];
    const eventArg = args[0]?.toLowerCase() as EventType | undefined;

    if (!eventArg) {
      await ctx.reply(
        `⚠️ <b>Usage:</b> <code>/unset_topic &lt;event&gt;</code>\nExample: <code>/unset_topic pushes</code> or <code>/unset_topic all</code>`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    store.unsetTopic(ctx.chat.id, eventArg);
    await ctx.reply(
      `✅ Topic routing cleared for event <b>${escapeHtml(eventArg)}</b>. It will fall back to default routing.`,
      {
        parse_mode: 'HTML',
        message_thread_id: ctx.message?.message_thread_id,
      }
    );
  });

  // /subscribe command
  bot.command('subscribe', async (ctx) => {
    if (!(await isChatAdmin(ctx))) {
      await ctx.reply('⛔ Only chat administrators can subscribe to repositories.');
      return;
    }

    const args = ctx.message?.text?.split(/\s+/).slice(1) || [];
    const repoArg = args[0];

    if (!repoArg || !/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+$/.test(repoArg) || repoArg.includes('..')) {
      await ctx.reply(
        `⚠️ <b>Usage:</b> <code>/subscribe &lt;owner/repo&gt;</code>\nExample: <code>/subscribe torvalds/linux</code>`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    if (!store.isRepoAllowed(ctx.chat.id, repoArg)) {
      await ctx.reply('This repository is not approved for this chat. Ask the bot operator to allow it.');
      return;
    }
    const added = store.subscribeRepo(ctx.chat.id, repoArg);
    if (added) {
      await ctx.reply(
        `✅ Subscribed to repository <code>${escapeHtml(repoArg)}</code>! Webhook events from this repository will be posted here.`,
        {
          parse_mode: 'HTML',
          message_thread_id: ctx.message?.message_thread_id,
        }
      );
    } else {
      await ctx.reply(
        `ℹ️ Already subscribed to <code>${escapeHtml(repoArg)}</code>.`,
        {
          parse_mode: 'HTML',
          message_thread_id: ctx.message?.message_thread_id,
        }
      );
    }
  });

  // /unsubscribe command
  bot.command('unsubscribe', async (ctx) => {
    if (!(await isChatAdmin(ctx))) {
      await ctx.reply('⛔ Only chat administrators can unsubscribe from repositories.');
      return;
    }

    const args = ctx.message?.text?.split(/\s+/).slice(1) || [];
    const repoArg = args[0];

    if (!repoArg) {
      await ctx.reply(
        `⚠️ <b>Usage:</b> <code>/unsubscribe &lt;owner/repo&gt;</code>`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    const removed = store.unsubscribeRepo(ctx.chat.id, repoArg);
    if (removed) {
      await ctx.reply(
        `✅ Unsubscribed from repository <code>${escapeHtml(repoArg)}</code>.`,
        {
          parse_mode: 'HTML',
          message_thread_id: ctx.message?.message_thread_id,
        }
      );
    } else {
      await ctx.reply(
        `ℹ️ Repository <code>${escapeHtml(repoArg)}</code> was not in the subscription list.`,
        {
          parse_mode: 'HTML',
          message_thread_id: ctx.message?.message_thread_id,
        }
      );
    }
  });

  // /repos command
  bot.command('repos', async (ctx) => {
    const chat = store.getOrCreateChat(ctx.chat.id, ctx.chat.title || 'Chat');
    if (chat.subscribedRepos.length === 0) {
      await ctx.reply(
        `📦 <b>Subscribed Repositories:</b>\n<i>No repositories configured. Use /subscribe &lt;owner/repo&gt; to add one.</i>`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    let text = `📦 <b>Subscribed Repositories:</b>\n\n`;
    for (const repo of chat.subscribedRepos) {
      text += `• <code>${escapeHtml(repo)}</code>\n`;
    }

    await ctx.reply(text, {
      parse_mode: 'HTML',
      message_thread_id: ctx.message?.message_thread_id,
    });
  });

  // /filter_branches command
  bot.command('filter_branches', async (ctx) => {
    if (!(await isChatAdmin(ctx))) {
      await ctx.reply('⛔ Only chat administrators can set branch filters.');
      return;
    }

    const args = ctx.message?.text?.split(/\s+/).slice(1) || [];
    if (args.length === 0) {
      const chat = store.getOrCreateChat(ctx.chat.id);
      const current = chat.branchFilter.length > 0 ? chat.branchFilter.join(', ') : 'All branches';
      await ctx.reply(
        `🌿 <b>Current Branch Filter:</b> <code>${escapeHtml(current)}</code>\n\n` +
          `<b>Usage:</b>\n` +
          `• <code>/filter_branches main master release/*</code>\n` +
          `• <code>/filter_branches all</code> (to clear and allow all branches)`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    if (args[0].toLowerCase() === 'all') {
      store.setBranchFilter(ctx.chat.id, []);
      await ctx.reply('✅ Branch filter cleared. Notifications will be sent for <b>all branches</b>.', {
        parse_mode: 'HTML',
      });
      return;
    }

    store.setBranchFilter(ctx.chat.id, args);
    await ctx.reply(
      `✅ Branch filter set! Only notifications for: ${args.map((b) => `<code>${escapeHtml(b)}</code>`).join(', ')} will be delivered.`,
      { parse_mode: 'HTML' }
    );
  });

  bot.command('workflow_alerts', async (ctx) => {
    if (!(await isChatAdmin(ctx))) {
      await ctx.reply('Only chat administrators can change workflow alerts.');
      return;
    }
    const mode = ctx.message?.text?.split(/\s+/)[1];
    if (mode !== 'all' && mode !== 'failures') {
      await ctx.reply('Usage: /workflow_alerts <all|failures>');
      return;
    }
    store.updateChat(ctx.chat.id, { workflowAlerts: mode });
    await ctx.reply(`Workflow alerts: ${mode}. Enable workflow events in /settings to receive them.`);
  });

  // Handle Inline Keyboard Callback Queries
  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;
    const chatId = ctx.chat?.id;

    if (!chatId) {
      await ctx.answerCallbackQuery({ text: 'Error: Chat not found.' });
      return;
    }

    if (!(await isChatAdmin(ctx))) {
      await ctx.answerCallbackQuery({
        text: '⛔ Only chat administrators can change settings.',
        show_alert: true,
      });
      return;
    }

    const chat = store.getOrCreateChat(chatId);

    if (data === 'menu:main') {
      await ctx.editMessageText(buildSettingsText(chat), {
        parse_mode: 'HTML',
        reply_markup: buildMainMenuKeyboard(chat),
      });
      await ctx.answerCallbackQuery();
    } else if (data === 'menu:events') {
      await ctx.editMessageText('🔔 <b>Select which GitHub events to notify:</b>', {
        parse_mode: 'HTML',
        reply_markup: buildEventsMenuKeyboard(chat),
      });
      await ctx.answerCallbackQuery();
    } else if (data.startsWith('toggle_event:')) {
      const eventKey = data.replace('toggle_event:', '') as keyof typeof chat.eventsEnabled;
      if (chat.eventsEnabled[eventKey] !== undefined) {
        store.toggleEvent(chatId, eventKey);
        // Refresh events menu
        await ctx.editMessageReplyMarkup({
          reply_markup: buildEventsMenuKeyboard(store.getOrCreateChat(chatId)),
        });
        await ctx.answerCallbackQuery({ text: `Toggled ${eventKey}` });
      }
    } else if (data.startsWith('menu:assign_topic:')) {
      const threadId = parseInt(data.replace('menu:assign_topic:', ''), 10);
      await ctx.editMessageText(
        `🎯 <b>Assign Topic #${threadId}</b>\n\nChoose which events should be posted to this topic:`,
        {
          parse_mode: 'HTML',
          reply_markup: buildAssignTopicKeyboard(threadId),
        }
      );
      await ctx.answerCallbackQuery();
    } else if (data.startsWith('assign_thread:')) {
      const parts = data.split(':');
      const threadId = parseInt(parts[1], 10);
      const eventType = parts[2] as EventType;
      store.setTopic(chatId, eventType, threadId, `Topic #${threadId}`);

      await ctx.editMessageText(
        `✅ <b>Assigned!</b>\n\nEvent <b>${eventType}</b> is now routed to Topic #${threadId}.\n\n` +
          buildSettingsText(store.getOrCreateChat(chatId)),
        {
          parse_mode: 'HTML',
          reply_markup: buildMainMenuKeyboard(store.getOrCreateChat(chatId), threadId),
        }
      );
      await ctx.answerCallbackQuery({ text: `Assigned #${threadId} to ${eventType}` });
    } else if (data === 'menu:toggle_silent') {
      const isSilent = store.toggleSilent(chatId);
      await ctx.editMessageText(buildSettingsText(store.getOrCreateChat(chatId)), {
        parse_mode: 'HTML',
        reply_markup: buildMainMenuKeyboard(store.getOrCreateChat(chatId)),
      });
      await ctx.answerCallbackQuery({
        text: isSilent ? 'Notifications muted' : 'Notifications unmuted',
      });
    } else if (data === 'menu:verbosity') {
      const newVerbosity = chat.verbosity === 'detailed' ? 'compact' : 'detailed';
      store.setVerbosity(chatId, newVerbosity);
      await ctx.editMessageText(buildSettingsText(store.getOrCreateChat(chatId)), {
        parse_mode: 'HTML',
        reply_markup: buildMainMenuKeyboard(store.getOrCreateChat(chatId)),
      });
      await ctx.answerCallbackQuery({ text: `Verbosity set to ${newVerbosity}` });
    } else if (data === 'menu:workflow') {
      const mode = chat.workflowAlerts === 'failures' ? 'all' : 'failures';
      store.updateChat(chatId, { workflowAlerts: mode });
      await ctx.editMessageText(buildSettingsText(store.getOrCreateChat(chatId)), {
        parse_mode: 'HTML',
        reply_markup: buildMainMenuKeyboard(store.getOrCreateChat(chatId)),
      });
      await ctx.answerCallbackQuery({ text: `Workflow alerts: ${mode}` });
    } else if (data === 'menu:clear_topics') {
      store.updateChat(chatId, { topics: {}, topicNames: {} });
      await ctx.editMessageText(
        `✅ All custom topic routes cleared!\n\n` + buildSettingsText(store.getOrCreateChat(chatId)),
        {
          parse_mode: 'HTML',
          reply_markup: buildMainMenuKeyboard(store.getOrCreateChat(chatId)),
        }
      );
      await ctx.answerCallbackQuery({ text: 'Topic routes cleared' });
    } else if (data === 'menu:refresh') {
      await ctx.editMessageText(buildSettingsText(chat), {
        parse_mode: 'HTML',
        reply_markup: buildMainMenuKeyboard(chat),
      });
      await ctx.answerCallbackQuery({ text: 'Refreshed' });
    }
  });
}
