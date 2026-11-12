import { Bot, Context, InlineKeyboard, Keyboard } from 'grammy';
import { store } from '../storage/store.js';
import { config } from '../config.js';
import { EventType } from '../types/store.js';
import { isChatAdmin, escapeHtml } from './utils.js';
import { validTime, validTimeZone } from './digest.js';
import { eventNames, topicNames, setRepositoryBranches, setRepositoryEvent, setRepositoryTopic, formatRepositoryRule } from './repository_rules.js';
import { retryFailedDeliveries } from '../github/notifier.js';

const commandKeyboard = new Keyboard()
  .text('📋 Menu', { style: 'primary' }).text('📊 Status', { style: 'primary' }).row()
  .text('🚨 Failed deliveries', { style: 'danger' }).text('🔁 Retry failed', { style: 'success' })
  .resized().persistent();
import {
  buildSettingsText,
  buildMainMenuKeyboard,
  buildEventsMenuKeyboard,
  buildAssignTopicKeyboard,
} from './menus.js';

export function registerBotCommands(bot: Bot): void {
  const keyboardActions: Record<string, string> = {
    '📋 Menu': '/menu',
    '📊 Status': '/status',
    '🚨 Failed deliveries': '/failed_deliveries',
    '🔁 Retry failed': '/retry_failed',
  };
  bot.use(async (ctx, next) => {
    const text = ctx.message?.text;
    if (text && keyboardActions[text] && ctx.message) ctx.message.text = keyboardActions[text];
    await next();
  });

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

    await ctx.reply(welcome, { parse_mode: 'HTML', reply_markup: commandKeyboard });
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
    help += `• <code>/quiet_hours 22:00 08:00 Africa/Nairobi</code> &mdash; Pause routine alerts\n`;
    help += `• <code>/digest daily 09:00 Africa/Nairobi</code> &mdash; Send routine activity daily\n`;
    help += `• <code>/test</code> &mdash; Send a test notification to this chat\n`;
    help += `• <code>/delivery_status</code> &mdash; Show recent delivery outcomes\n`;
    help += `• <code>/failed_deliveries</code> &mdash; List messages needing retry\n`;
    help += `• <code>/retry_failed</code> &mdash; Retry failed Telegram sends\n`;
    help += `• <code>/repo_rules owner/repo</code> &mdash; Show repository overrides\n`;
    help += `• <code>/repo_event owner/repo pushes off</code> &mdash; Override an event\n`;
    help += `• <code>/repo_branches owner/repo main</code> &mdash; Override branches\n`;
    help += `• <code>/repo_topic owner/repo pushes here</code> &mdash; Override a topic\n`;

    await ctx.reply(help, { parse_mode: 'HTML', reply_markup: commandKeyboard });
  });

  // /settings command
  bot.command(['menu', 'settings', 'config'], async (ctx) => {
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

  bot.command('test', async (ctx) => {
    if (!(await isChatAdmin(ctx))) { await ctx.reply('Only chat administrators can test delivery.'); return; }
    const chat = store.getOrCreateChat(ctx.chat.id, ctx.chat.title || 'Chat', Boolean(ctx.chat.is_forum));
    await ctx.reply(`✅ <b>Test notification delivered</b>\n\nChat: <code>${chat.chatId}</code>\nSubscribed repositories: <b>${chat.subscribedRepos.length}</b>\n\nThis confirms Telegram delivery. Use /status to review webhook settings.`, {
      parse_mode: 'HTML', message_thread_id: ctx.message?.message_thread_id,
    });
  });

  bot.command('delivery_status', async (ctx) => {
    const rows = store.getDeliveryStatus(ctx.chat.id).slice(0, 5);
    const details = rows.map(item => `• <code>${escapeHtml(item.repo)}</code> ${escapeHtml(item.eventType)}: <b>${escapeHtml(item.state)}</b>${item.detail ? ` (${escapeHtml(item.detail)})` : ''}`);
    await ctx.reply(`<b>Recent GitHub deliveries</b>\n\n${details.join('\n') || 'No deliveries recorded yet.'}`, {
      parse_mode: 'HTML', message_thread_id: ctx.message?.message_thread_id,
    });
  });

  bot.command('failed_deliveries', async (ctx) => {
    const failed = store.getFailedDeliveries(ctx.chat.id).slice(0, 5);
    const lines = failed.map(item => `• <code>${escapeHtml(item.repo)}</code> ${escapeHtml(item.eventType)} · ${item.attempts} attempts`);
    await ctx.reply(`<b>Failed deliveries</b>\n\n${lines.join('\n') || 'No failed messages.'}\n\n${failed.length ? 'Use /retry_failed to retry them.' : ''}`, { parse_mode: 'HTML' });
  });

  bot.command('retry_failed', async (ctx) => {
    if (!(await isChatAdmin(ctx))) { await ctx.reply('Only chat administrators can retry failed deliveries.'); return; }
    const result = await retryFailedDeliveries(ctx.chat.id);
    await ctx.reply(`Retried ${result.retried} failed message(s); ${result.succeeded} delivered successfully.`);
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
          `• <code>reviews</code> (Pull request reviews)\n` +
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
      'reviews',
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

  bot.command('quiet_hours', async (ctx) => {
    if (!(await isChatAdmin(ctx))) { await ctx.reply('Only chat administrators can change quiet hours.'); return; }
    const parts = ctx.message?.text?.split(/\s+/).slice(1) || [];
    if (parts[0] === 'off') {
      store.updateChat(ctx.chat.id, { quietHours: null });
      await ctx.reply('Quiet hours off.');
      return;
    }
    const [start, end, timeZone] = parts;
    if (!validTime(start || '') || !validTime(end || '') || start === end || !validTimeZone(timeZone || '')) {
      await ctx.reply('Usage: /quiet_hours <HH:MM> <HH:MM> <IANA timezone> or /quiet_hours off. Example: /quiet_hours 22:00 08:00 Africa/Nairobi');
      return;
    }
    store.updateChat(ctx.chat.id, { quietHours: { start, end, timeZone } });
    await ctx.reply(`Quiet hours: ${start}–${end} (${timeZone}).`);
  });

  bot.command('digest', async (ctx) => {
    if (!(await isChatAdmin(ctx))) { await ctx.reply('Only chat administrators can change the digest.'); return; }
    const parts = ctx.message?.text?.split(/\s+/).slice(1) || [];
    if (parts[0] === 'off') {
      store.updateChat(ctx.chat.id, { dailyDigest: null });
      await ctx.reply('Daily digest off. Pending items will send after quiet hours.');
      return;
    }
    const [mode, time, timeZone] = parts;
    if (mode !== 'daily' || !validTime(time || '') || !validTimeZone(timeZone || '')) {
      await ctx.reply('Usage: /digest daily <HH:MM> <IANA timezone> or /digest off. Example: /digest daily 09:00 Africa/Nairobi');
      return;
    }
    store.updateChat(ctx.chat.id, { dailyDigest: { time, timeZone }, lastDigestDate: undefined });
    await ctx.reply(`Daily digest: ${time} (${timeZone}).`);
  });

  async function manageRepositoryRule(ctx: Context, command: string): Promise<void> {
    if (!(await isChatAdmin(ctx))) { await ctx.reply('Only chat administrators can manage repository rules.'); return; }
    const parts = ctx.message?.text?.split(/\s+/).slice(1) || [];
    const repo = (parts[0] || '').toLowerCase();
    const chat = store.getOrCreateChat(ctx.chat!.id);
    if (!chat.subscribedRepos.some(value => value.toLowerCase() === repo)) {
      await ctx.reply('Use a subscribed repository in owner/repo format. Run /repos to see subscriptions.'); return;
    }
    if (command === 'repo_event') {
      const event = parts[1] as keyof typeof chat.eventsEnabled;
      const mode = parts[2] as 'on' | 'off' | 'inherit';
      if (!eventNames.includes(event) || !['on', 'off', 'inherit'].includes(mode)) {
        await ctx.reply('Usage: /repo_event owner/repo <event> <on|off|inherit>'); return;
      }
      setRepositoryEvent(chat, repo, event, mode);
    } else if (command === 'repo_branches') {
      const branches = parts.slice(1);
      if (!branches.length) { await ctx.reply('Usage: /repo_branches owner/repo <branch...|all|inherit>'); return; }
      setRepositoryBranches(chat, repo, branches[0] === 'inherit' ? undefined : branches[0] === 'all' ? [] : branches);
    } else if (command === 'repo_topic') {
      const event = parts[1] as EventType;
      const value = parts[2];
      if (!topicNames.includes(event) || !value) { await ctx.reply('Usage: /repo_topic owner/repo <event|all> <here|topic-id|general|inherit>'); return; }
      let topic: number | null | undefined;
      if (value === 'inherit') topic = undefined;
      else if (value === 'general') topic = null;
      else if (value === 'here' && ctx.message?.message_thread_id) topic = ctx.message.message_thread_id;
      else if (/^[1-9]\d*$/.test(value)) topic = Number(value);
      else { await ctx.reply('Use here inside a topic, a positive topic ID, general, or inherit.'); return; }
      if (topic !== null && topic !== undefined && !Number.isSafeInteger(topic)) { await ctx.reply('Invalid topic ID.'); return; }
      setRepositoryTopic(chat, repo, event, topic);
    }
    if (command !== 'repo_rules') store.updateChat(ctx.chat!.id, { repositoryRules: chat.repositoryRules });
    await ctx.reply(`<b>Rules for ${escapeHtml(repo)}</b>\n\n<pre>${escapeHtml(formatRepositoryRule(chat, repo))}</pre>`, { parse_mode: 'HTML' });
  }
  for (const command of ['repo_rules', 'repo_event', 'repo_branches', 'repo_topic'] as const) {
    bot.command(command, async ctx => manageRepositoryRule(ctx, command));
  }

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
