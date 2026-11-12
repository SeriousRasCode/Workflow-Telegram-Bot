import { parseAndDispatchGitHubEvent } from './github/dispatcher.js';
import type { ChatSettings, EventType } from './types/store.js';
import type { D1Database, ExecutionContext, ScheduledEvent } from '@cloudflare/workers-types';
import { buildMenu, repoKey, type MenuView, type ConnectionSummary } from './worker/menu.js';
import { selectWorkflowAlert, recordWorkflowAlert } from './github/workflow_alerts.js';
import { digestDue, digestItem, digestMessages, shouldQueueDigest, validTime, validTimeZone } from './bot/digest.js';
import { effectiveSettings, eventNames, topicNames, setRepositoryBranches, setRepositoryEvent, setRepositoryTopic, formatRepositoryRule } from './bot/repository_rules.js';

interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
}
type TgChat = { id: number; type: string; title?: string; is_forum?: boolean };
type TgUpdate = { message?: { chat: TgChat; from?: { id: number }; text?: string; message_thread_id?: number }; channel_post?: { chat: TgChat; from?: { id: number }; text?: string; message_thread_id?: number }; callback_query?: { id: string; from: { id: number }; message?: { chat: TgChat; message_id: number; message_thread_id?: number }; data?: string } };
type Job = { delivery_id: string; chat_id: string; message: string; thread_id: number | null; silent: number; attempts: number };
const commandKeyboard = { keyboard: [
  [{ text: '📋 Menu', style: 'primary' }, { text: '📊 Status', style: 'primary' }],
  [{ text: '🚨 Failed deliveries', style: 'danger' }, { text: '🔁 Retry failed', style: 'success' }],
], resize_keyboard: true, is_persistent: true };

const events: EventType[] = ['all', 'pushes', 'prs', 'reviews', 'issues', 'comments', 'releases', 'workflows', 'stars', 'forks'];
const repoPattern = /^[a-z0-9][a-z0-9-]*\/[a-z0-9._-]+$/i;
const ownerPattern = /^[a-z0-9][a-z0-9-]*$/i;
const reply = (body: string, status = 200) => new Response(body, { status });

async function telegram(env: Env, method: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const data: any = await res.json();
  if (!data.ok) throw new Error(`${method}: ${data.description || res.status}`);
  return data.result;
}

async function send(env: Env, chatId: string | number, text: string, threadId?: number | null, html = false): Promise<void> {
  await telegram(env, 'sendMessage', {
    chat_id: chatId, text, ...(html ? { parse_mode: 'HTML' } : {}),
    ...(threadId ? { message_thread_id: threadId } : {}),
    link_preview_options: { is_disabled: true },
  });
}

async function admin(env: Env, chat: TgChat, userId: number): Promise<boolean> {
  if (chat.type === 'private') return true;
  const member = await telegram(env, 'getChatMember', { chat_id: chat.id, user_id: userId });
  return member.status === 'creator' || member.status === 'administrator';
}

function defaultSettings(chat: TgChat): ChatSettings {
  const now = new Date().toISOString();
  return { chatId: chat.id, chatTitle: chat.title || 'Chat', isForum: Boolean(chat.is_forum), subscribedRepos: [], topics: {}, topicNames: {},
    eventsEnabled: { pushes: true, prs: true, reviews: false, issues: true, comments: false, releases: true, workflows: false, stars: true, forks: true },
    branchFilter: [], verbosity: 'detailed', workflowAlerts: 'all', workflowFailures: {}, quietHours: null, dailyDigest: null,
    silent: false, createdAt: now, updatedAt: now };
}

async function getSettings(env: Env, chat: TgChat): Promise<ChatSettings> {
  const row = await env.DB.prepare('SELECT settings FROM chats WHERE chat_id=?').bind(String(chat.id)).first<{ settings: string }>();
  if (!row) return defaultSettings(chat);
  const settings = JSON.parse(row.settings) as ChatSettings;
  settings.eventsEnabled = { ...defaultSettings(chat).eventsEnabled, ...settings.eventsEnabled };
  return settings;
}

async function saveSettings(env: Env, settings: ChatSettings): Promise<void> {
  settings.updatedAt = new Date().toISOString();
  await env.DB.prepare('INSERT INTO chats(chat_id,settings,updated_at) VALUES(?,?,?) ON CONFLICT(chat_id) DO UPDATE SET settings=excluded.settings,updated_at=excluded.updated_at')
    .bind(String(settings.chatId), JSON.stringify(settings), Date.now()).run();
}

async function recordStatus(env: Env, chatId: string, deliveryId: string, repo: string, eventType: string, state: string, detail = ''): Promise<void> {
  await env.DB.prepare('INSERT INTO delivery_status(chat_id,delivery_id,repo,event_type,state,detail,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(chat_id,delivery_id) DO UPDATE SET state=excluded.state,detail=excluded.detail,updated_at=excluded.updated_at')
    .bind(chatId, deliveryId, repo, eventType, state, detail, Date.now()).run();
}

async function menuFor(env: Env, chat: TgChat, view: MenuView, threadId?: number) {
  const settings = await getSettings(env, chat);
  const rows = await env.DB.prepare('SELECT owner,verified FROM connections WHERE chat_id=? ORDER BY owner').bind(String(chat.id)).all<ConnectionSummary>();
  const failed = await env.DB.prepare('SELECT COUNT(*) AS count FROM failed_jobs WHERE chat_id=?').bind(String(chat.id)).first<{ count: number }>();
  return buildMenu(view, settings, rows.results, threadId, failed?.count || 0);
}

async function handleMenuCallback(env: Env, update: TgUpdate): Promise<Response> {
  const query = update.callback_query!;
  const message = query.message;
  const answer = (text?: string, showAlert = false) => telegram(env, 'answerCallbackQuery', {
    callback_query_id: query.id, ...(text ? { text, show_alert: showAlert } : {}),
  });
  if (!message || !query.data?.startsWith('m:')) { await answer(); return reply('ok'); }
  const parts = query.data.split(':');
  const targetId = Number(parts[1]);
  if (!Number.isSafeInteger(targetId) || (message.chat.type !== 'private' && targetId !== message.chat.id)) {
    await answer('This menu belongs to another chat.', true); return reply('ok');
  }
  const target: TgChat = targetId === message.chat.id ? message.chat : { id: targetId, type: 'supergroup' };
  if (!(await admin(env, target, query.from.id))) { await answer('Only chat administrators can manage this bot.', true); return reply('ok'); }
  if (message.chat.type === 'private') {
    await env.DB.prepare('INSERT INTO user_chat_contexts(user_id,chat_id,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET chat_id=excluded.chat_id,updated_at=excluded.updated_at')
      .bind(String(query.from.id), String(targetId), Date.now()).run();
  }
  const settings = await getSettings(env, target);
  let view: MenuView = 'home';
  let threadId = message.message_thread_id;
  const action = parts[2];
  if (['home', 'repos', 'events', 'topics', 'prefs', 'connections', 'failed'].includes(action)) {
    view = action as MenuView;
    if (action === 'topics' && parts[3]) threadId = Number(parts[3]);
  } else if (action === 'retry_failed') {
    const jobs = await env.DB.prepare('SELECT * FROM failed_jobs WHERE chat_id=? ORDER BY failed_at LIMIT 50')
      .bind(String(targetId)).all<Job>();
    for (const job of jobs.results) {
      await env.DB.batch([
        env.DB.prepare('INSERT OR IGNORE INTO jobs(delivery_id,chat_id,message,thread_id,silent,attempts,next_attempt_at,created_at) VALUES(?,?,?,?,?,0,?,?)')
          .bind(job.delivery_id, job.chat_id, job.message, job.thread_id, job.silent, Date.now(), Date.now()),
        env.DB.prepare('DELETE FROM failed_jobs WHERE delivery_id=? AND chat_id=?').bind(job.delivery_id, job.chat_id),
        env.DB.prepare("UPDATE delivery_status SET state='queued',detail='Manual retry',updated_at=? WHERE chat_id=? AND delivery_id=?")
          .bind(Date.now(), job.chat_id, job.delivery_id),
      ]);
    }
    view = 'failed';
    await answer(`Queued ${jobs.results.length} message(s) for retry.`);
  } else if (action === 'event') {
    const event = parts[3] as keyof ChatSettings['eventsEnabled'];
    if (!event || !(event in settings.eventsEnabled)) { await answer('Unknown event.', true); return reply('ok'); }
    settings.eventsEnabled[event] = !settings.eventsEnabled[event];
    await saveSettings(env, settings);
    view = 'events';
  } else if (action === 'verbosity') {
    settings.verbosity = settings.verbosity === 'compact' ? 'detailed' : 'compact';
    await saveSettings(env, settings);
    view = 'prefs';
  } else if (action === 'silent') {
    settings.silent = !settings.silent;
    await saveSettings(env, settings);
    view = 'prefs';
  } else if (action === 'workflow') {
    settings.workflowAlerts = settings.workflowAlerts === 'failures' ? 'all' : 'failures';
    await saveSettings(env, settings);
    view = 'prefs';
  } else if (action === 'unsub') {
    const index = Number(parts[3]);
    const repo = settings.subscribedRepos[index];
    if (!Number.isSafeInteger(index) || !repo || repoKey(repo) !== parts[4]) { await answer('Menu changed. Open /menu again.', true); return reply('ok'); }
    await env.DB.prepare('DELETE FROM subscriptions WHERE chat_id=? AND repo=?').bind(String(targetId), repo.toLowerCase()).run();
    settings.subscribedRepos.splice(index, 1);
    delete settings.repositoryRules?.[repo.toLowerCase()];
    await saveSettings(env, settings);
    view = 'repos';
  } else if (action === 'sub') {
    const index = Number(parts[3]);
    const rows = await env.DB.prepare('SELECT owner,verified FROM connections WHERE chat_id=? ORDER BY owner').bind(String(targetId)).all<ConnectionSummary>();
    const connection = rows.results[index];
    if (!Number.isSafeInteger(index) || !connection?.owner.includes('/') || repoKey(connection.owner) !== parts[4]) {
      await answer('Menu changed. Open /menu again.', true); return reply('ok');
    }
    const repo = connection.owner.toLowerCase();
    await env.DB.prepare('INSERT OR IGNORE INTO subscriptions(chat_id,repo) VALUES(?,?)').bind(String(targetId), repo).run();
    if (!settings.subscribedRepos.includes(repo)) settings.subscribedRepos.push(repo);
    await saveSettings(env, settings);
    view = 'repos';
  } else if (action === 'topic') {
    const selectedThread = Number(parts[3]);
    const event = parts[4] as EventType;
    if (!Number.isSafeInteger(selectedThread) || selectedThread <= 0 || !events.includes(event) ||
        message.chat.id !== targetId || message.message_thread_id !== selectedThread) {
      await answer('Open this menu inside a forum topic.', true); return reply('ok');
    }
    settings.topics[event] = selectedThread;
    await saveSettings(env, settings);
    view = 'topics';
    threadId = selectedThread;
  } else if (action === 'untopic') {
    const event = parts[3] as EventType;
    if (!events.includes(event) || !(event in settings.topics)) { await answer('This route is already clear.', true); return reply('ok'); }
    delete settings.topics[event];
    await saveSettings(env, settings);
    view = 'topics';
  } else { await answer('Unknown menu action.', true); return reply('ok'); }
  await answer();
  const menu = await menuFor(env, target, view, threadId);
  try {
    await telegram(env, 'editMessageText', { chat_id: message.chat.id, message_id: message.message_id,
      text: menu.text, parse_mode: 'HTML', reply_markup: menu.reply_markup, link_preview_options: { is_disabled: true } });
  } catch (err) {
    if (!String(err).includes('message is not modified')) throw err;
  }
  return reply('ok');
}

function escape(text: string): string { return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

export function connectionMatches(scope: string, payload: { organization?: { login?: string }; repository?: { full_name?: string } }): boolean {
  const repo = String(payload.repository?.full_name || '').toLowerCase();
  if (scope.includes('/')) return repo === scope;
  return String(payload.organization?.login || repo.split('/')[0] || '').toLowerCase() === scope;
}

export function isChannelPost(update: TgUpdate): boolean {
  return update.channel_post?.chat.type === 'channel';
}

async function handleTelegram(request: Request, env: Env): Promise<Response> {
  if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.TELEGRAM_WEBHOOK_SECRET) return reply('Unauthorized', 401);
  const update = await request.json() as TgUpdate;
  const msg = update.message || update.channel_post;
  if (update.callback_query) {
    return handleMenuCallback(env, update);
  }
  if (!msg?.text) return reply('ok');
  const keyboardActions: Record<string, string> = {
    '📋 Menu': '/menu',
    '📊 Status': '/status',
    '🚨 Failed deliveries': '/failed_deliveries',
    '🔁 Retry failed': '/retry_failed',
  };
  const parts = (keyboardActions[msg.text.trim()] || msg.text.trim()).split(/\s+/);
  const command = parts.shift()?.split('@')[0].toLowerCase();
  if (!command?.startsWith('/')) return reply('ok');
  const userId = msg.from?.id;
  const chat = msg.chat;
  const thread = msg.message_thread_id;
  const isPrivate = chat.type === 'private';
  const explicitTargetId = isPrivate && /^-?\d+$/.test(parts[0] || '') ? Number(parts.shift()) : undefined;
  const linked = isPrivate && userId !== undefined
    ? await env.DB.prepare('SELECT chat_id FROM user_chat_contexts WHERE user_id=?').bind(String(userId)).first<{ chat_id: string }>()
    : null;
  const targetId = explicitTargetId ?? (linked ? Number(linked.chat_id) : chat.id);
  const target: TgChat = targetId === chat.id ? chat : { id: targetId, type: 'supergroup' };
  const respond = (text: string, html = false) => send(env, chat.id, text, thread, html);

  if (command === '/start' || command === '/help') {
    await telegram(env, 'setMyCommands', { commands: [
      { command: 'menu', description: 'Open the interactive bot menu' },
      { command: 'link', description: 'Link this group to your private keyboard' },
      { command: 'status', description: 'View connection and subscription status' },
      { command: 'subscribe', description: 'Follow a repository' },
      { command: 'unsubscribe', description: 'Unfollow a repository' },
      { command: 'repos', description: 'List followed repositories' },
      { command: 'test', description: 'Send a test notification' },
      { command: 'delivery_status', description: 'Show recent delivery outcomes' },
      { command: 'failed_deliveries', description: 'List Telegram messages needing retry' },
      { command: 'retry_failed', description: 'Retry failed Telegram messages' },
      { command: 'quiet_hours', description: 'Configure quiet hours' },
      { command: 'digest', description: 'Configure a daily digest' },
      { command: 'help', description: 'Show setup instructions' },
    ] });
  }

  if (command === '/menu' || command === '/settings') {
    const channelCommand = isChannelPost(update);
    if (!userId && !channelCommand) return reply('ok');
    if (isPrivate && targetId === chat.id) { await respond('Run <code>/link</code> in the group or channel first, then use this private menu. You can also send <code>/menu CHAT_ID</code>.', true); return reply('ok'); }
    if (!channelCommand && !(await admin(env, target, userId!))) { await respond('Only chat administrators can open this menu.'); return reply('ok'); }
    if (isPrivate && userId) {
      await env.DB.prepare('INSERT INTO user_chat_contexts(user_id,chat_id,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET chat_id=excluded.chat_id,updated_at=excluded.updated_at')
        .bind(String(userId), String(targetId), Date.now()).run();
    }
    const menu = await menuFor(env, target, 'home', thread);
    await telegram(env, 'sendMessage', { chat_id: chat.id, text: menu.text, parse_mode: 'HTML', reply_markup: menu.reply_markup,
      ...(thread ? { message_thread_id: thread } : {}), link_preview_options: { is_disabled: true } });
    return reply('ok');
  }

  if (command === '/start' && isPrivate && /^connect_-?\d+$/.test(parts[0] || '')) {
    const linkedChatId = parts[0].slice('connect_'.length);
    const linkedChat = await telegram(env, 'getChat', { chat_id: linkedChatId }) as TgChat;
    if (!userId || !(await admin(env, linkedChat, userId))) {
      await respond('Only an administrator of that group or channel can link it to this private keyboard.');
      return reply('ok');
    }
    await env.DB.prepare('INSERT INTO user_chat_contexts(user_id,chat_id,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET chat_id=excluded.chat_id,updated_at=excluded.updated_at')
      .bind(String(userId), linkedChatId, Date.now()).run();
    const linkedSettings = await getSettings(env, linkedChat);
    linkedSettings.chatTitle = linkedChat.title || linkedSettings.chatTitle;
    linkedSettings.isForum = Boolean(linkedChat.is_forum);
    await saveSettings(env, linkedSettings);
    await telegram(env, 'sendMessage', { chat_id: chat.id, text: `<b>Linked keyboard to ${escape(linkedChat.title || linkedChatId)}</b>\n\nThe persistent buttons now manage this group or channel. You can switch the linked chat by opening another private setup link.`, parse_mode: 'HTML', reply_markup: commandKeyboard });
    await telegram(env, 'sendMessage', { chat_id: chat.id, text: 'Open the linked chat menu:', reply_markup: { inline_keyboard: [[{ text: '⚙️ Open chat menu', callback_data: `m:${linkedChatId}:home` }]] } });
    return reply('ok');
  }
  if (command === '/start' || command === '/help') {
    const text = '<b>GitHub notifications setup</b>\n\n1. Add me to your group or channel.\n2. Send <code>/link</code> there, or send <code>/link CHAT_ID</code> privately, to link your command keyboard.\n3. Message me privately: <code>/connect CHAT_ID owner/repo</code> for one repository, or <code>/connect CHAT_ID organization</code> for an entire organization.\n4. Add the GitHub webhook using the URL and secret I send you.\n5. Subscribe with <code>/subscribe owner/repo</code>.\n\nUse <code>/test</code> to check Telegram delivery and <code>/delivery_status</code> for recent GitHub outcomes. Open the menu below or use /menu.';
    const showKeyboard = !isPrivate || targetId !== chat.id;
    await telegram(env, 'sendMessage', { chat_id: chat.id, text, parse_mode: 'HTML', ...(thread ? { message_thread_id: thread } : {}),
      ...(showKeyboard ? { reply_markup: commandKeyboard } : {}) });
    return reply('ok');
  }
  if (command === '/status') {
    if (isPrivate && targetId === chat.id) {
      await respond('Run <code>/link</code> in the group or channel first so I can show its status.', true);
      return reply('ok');
    }
    if (isPrivate && userId) {
      if (!(await admin(env, target, userId))) { await respond('Only chat administrators can view this chat status.'); return reply('ok'); }
      await env.DB.prepare('INSERT INTO user_chat_contexts(user_id,chat_id,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET chat_id=excluded.chat_id,updated_at=excluded.updated_at')
        .bind(String(userId), String(targetId), Date.now()).run();
    }
    const settings = await getSettings(env, target);
    const owners = await env.DB.prepare('SELECT owner,verified FROM connections WHERE chat_id=?').bind(String(targetId)).all<{ owner: string; verified: number }>();
    const connections = owners.results.map((x: { owner: string; verified: number }) => `• ${escape(x.owner)} ${x.verified ? '✅ webhook confirmed' : '⏳ webhook not confirmed'}`).join('\n') || 'None yet';
    const repos = settings.subscribedRepos.map(x => `• ${escape(x)}`).join('\n') || 'None yet';
    await respond(`<b>Connection status</b>\n\n<b>Chat ID:</b> <code>${targetId}</code>\n\n<b>Connections</b>\n${connections}\n\n<b>Subscribed repositories</b>\n${repos}\n\n<b>Next step:</b> ${owners.results.length ? 'Use <code>/subscribe owner/repo</code> to follow a repository. If the webhook is unconfirmed, check GitHub’s Recent Deliveries.' : `Message me privately: <code>/connect ${targetId} owner/repo</code> (one repo) or <code>/connect ${targetId} organization</code> (all repos in an organization).`}`, true);
    return reply('ok');
  }
  if (command === '/link') {
    if (isPrivate && targetId === chat.id) {
      await respond('Run /link in the group or channel you want your private keyboard to manage.');
      return reply('ok');
    }
    const self = await telegram(env, 'getMe', {});
    await respond(`Open this private link to link your keyboard to <b>${escape(target.title || String(targetId))}</b>:\n<a href="https://t.me/${escape(self.username)}?start=connect_${targetId}">Link this chat</a>`, true);
    return reply('ok');
  }
  const channelCommand = isChannelPost(update);
  if (!userId && !channelCommand) return reply('ok');
  if (isPrivate && targetId === chat.id) { await respond('Send <code>/status</code> in your group or channel to get its chat ID. Then try <code>/connect CHAT_ID owner/repo</code> here.', true); return reply('ok'); }
  if (!channelCommand && !(await admin(env, target, userId!))) { await respond('Only chat administrators can change these settings.'); return reply('ok'); }
  const settings = await getSettings(env, target);

  if (command === '/connect') {
    const scope = (parts[0] || '').toLowerCase();
    if (!isPrivate) {
      const self = await telegram(env, 'getMe', {});
      const deepLink = `https://t.me/${self.username}?start=connect_${chat.id}`;
      const suggested = ownerPattern.test(scope) || repoPattern.test(scope) ? `\n\nFor your choice, send <code>/connect ${chat.id} ${escape(scope)}</code> there.` : '';
      await respond(`<b>Connect this chat</b>\n\n<a href="${escape(deepLink)}">Open private setup</a> to choose an organization or one repository. I’ll send the GitHub webhook URL and secret privately.${suggested}`, true);
      return reply('ok');
    }
    if (!(ownerPattern.test(scope) || repoPattern.test(scope)) || scope.includes('..')) { await respond('Use <code>/connect CHAT_ID organization</code> or <code>/connect CHAT_ID owner/repo</code>.', true); return reply('ok'); }
    const existing = await env.DB.prepare('SELECT secret,verified FROM connections WHERE chat_id=? AND owner=?').bind(String(targetId), scope).first<{ secret: string; verified: number }>();
    const secret = existing?.secret || Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
    if (!existing) await env.DB.prepare('INSERT INTO connections(chat_id,owner,secret,verified) VALUES(?,?,?,0)')
      .bind(String(targetId), scope, secret).run();
    await saveSettings(env, settings);
    const url = new URL(request.url);
    const kind = scope.includes('/') ? 'repository' : 'organization';
    await respond(`<b>${existing?.verified ? 'Connected' : `Connect ${kind}`}: ${escape(scope)}</b>\n\n1. Open this ${kind}’s GitHub <b>Settings → Webhooks → Add webhook</b>.\n2. Set <b>Payload URL</b> to:\n<code>${escape(`${url.origin}/github/${targetId}/${scope}`)}</code>\n3. Set <b>Content type</b> to <code>application/json</code>.\n4. Set <b>Secret</b> to:\n<code>${secret}</code>\n5. Select the events you want and save.\n\nGitHub sends a ping to verify it. Then use <code>/subscribe ${scope.includes('/') ? escape(scope) : `${escape(scope)}/repo-name`}</code> in the group. Keep this secret private.`, true);
    return reply('ok');
  }
  if (command === '/subscribe') {
    const repo = (parts[0] || '').toLowerCase();
    if (!repoPattern.test(repo) || repo.includes('..')) { await respond('Usage: /subscribe <owner/repo>'); return reply('ok'); }
    const owner = repo.split('/')[0];
    const conn = await env.DB.prepare('SELECT verified FROM connections WHERE chat_id=? AND owner IN (?,?) ORDER BY verified DESC LIMIT 1').bind(String(targetId), owner, repo).first<{ verified: number }>();
    if (!conn) {
      await respond(`<b>Connect this repository first</b>\n\nMessage me privately: <code>/connect ${targetId} ${escape(repo)}</code>\n\nI’ll send its GitHub webhook URL and secret.`, true);
      return reply('ok');
    }
    await env.DB.prepare('INSERT OR IGNORE INTO subscriptions(chat_id,repo) VALUES(?,?)').bind(String(targetId), repo).run();
    if (!settings.subscribedRepos.includes(repo)) settings.subscribedRepos.push(repo);
    await saveSettings(env, settings);
    await respond(`✅ <b>Subscription saved</b>\n\nThis chat now follows <code>${escape(repo)}</code>.${conn.verified ? '' : '\n\nThe GitHub webhook has not been confirmed yet. Notifications will start when a signed delivery reaches the bot. You can check the webhook’s Recent Deliveries in GitHub.'} Send <code>/settings</code> to review it.`, true); return reply('ok');
  }
  if (command === '/unsubscribe') {
    const repo = (parts[0] || '').toLowerCase();
    await env.DB.prepare('DELETE FROM subscriptions WHERE chat_id=? AND repo=?').bind(String(targetId), repo).run();
    settings.subscribedRepos = settings.subscribedRepos.filter(x => x.toLowerCase() !== repo);
    delete settings.repositoryRules?.[repo];
    await saveSettings(env, settings);
    await respond(`Removed <code>${escape(repo)}</code> from this chat.`, true); return reply('ok');
  }
  if (command === '/disconnect') {
    const scope = (parts[0] || '').toLowerCase();
    if (!(ownerPattern.test(scope) || repoPattern.test(scope))) { await respond('Usage: /disconnect <organization|owner/repo>'); return reply('ok'); }
    await env.DB.prepare('DELETE FROM connections WHERE chat_id=? AND owner=?').bind(String(targetId), scope).run();
    if (scope.includes('/')) {
      await env.DB.prepare('DELETE FROM subscriptions WHERE chat_id=? AND repo=?').bind(String(targetId), scope).run();
      settings.subscribedRepos = settings.subscribedRepos.filter(x => x.toLowerCase() !== scope);
      delete settings.repositoryRules?.[scope];
    } else {
      await env.DB.prepare('DELETE FROM subscriptions WHERE chat_id=? AND repo LIKE ?').bind(String(targetId), `${scope}/%`).run();
      settings.subscribedRepos = settings.subscribedRepos.filter(x => !x.toLowerCase().startsWith(`${scope}/`));
      for (const repo of Object.keys(settings.repositoryRules || {})) if (repo.startsWith(`${scope}/`)) delete settings.repositoryRules?.[repo];
    }
    await saveSettings(env, settings);
    await respond(`Disconnected ${scope} and removed its repository subscriptions.`); return reply('ok');
  }
  if (command === '/repos') { await respond(`<b>Repositories followed by this chat</b>\n\n${settings.subscribedRepos.map(x => `• <code>${escape(x)}</code>`).join('\n') || 'None yet. Use <code>/subscribe owner/repo</code>.'}`, true); return reply('ok'); }
  if (command === '/set_topic' || command === '/unset_topic') {
    const event = parts[0] as EventType;
    if (!events.includes(event)) { await respond(`Usage: ${command} <${events.join('|')}>`); return reply('ok'); }
    if (command === '/set_topic') settings.topics[event] = thread || null;
    else delete settings.topics[event];
    await saveSettings(env, settings);
    await respond(`Topic routing updated for ${event}.`); return reply('ok');
  }
  if (command === '/filter_branches') {
    settings.branchFilter = parts[0]?.toLowerCase() === 'all' ? [] : parts;
    await saveSettings(env, settings);
    await respond(`Branch filter: ${settings.branchFilter.join(', ') || 'all'}`); return reply('ok');
  }
  if (command === '/toggle_event') {
    const event = parts[0] as keyof ChatSettings['eventsEnabled'];
    if (!event || !(event in settings.eventsEnabled)) { await respond('Usage: /toggle_event <pushes|prs|issues|comments|releases|workflows|stars|forks>'); return reply('ok'); }
    settings.eventsEnabled[event] = !settings.eventsEnabled[event];
    await saveSettings(env, settings);
    await respond(`${event}: ${settings.eventsEnabled[event] ? 'on' : 'off'}`); return reply('ok');
  }
  if (command === '/verbosity') {
    if (parts[0] !== 'compact' && parts[0] !== 'detailed') { await respond('Usage: /verbosity <compact|detailed>'); return reply('ok'); }
    settings.verbosity = parts[0];
    await saveSettings(env, settings);
    await respond(`Verbosity: ${settings.verbosity}`); return reply('ok');
  }
  if (command === '/silent') {
    if (parts[0] !== 'on' && parts[0] !== 'off') { await respond('Usage: /silent <on|off>'); return reply('ok'); }
    settings.silent = parts[0] === 'on';
    await saveSettings(env, settings);
    await respond(`Silent notifications: ${settings.silent ? 'on' : 'off'}`); return reply('ok');
  }
  if (command === '/workflow_alerts') {
    if (parts[0] !== 'all' && parts[0] !== 'failures') { await respond('Usage: /workflow_alerts <all|failures>'); return reply('ok'); }
    settings.workflowAlerts = parts[0];
    await saveSettings(env, settings);
    await respond(`Workflow alerts: ${settings.workflowAlerts}. Enable workflow events in /menu to receive them.`); return reply('ok');
  }
  if (command === '/quiet_hours') {
    if (parts[0] === 'off') settings.quietHours = null;
    else {
      const [start, end, timeZone] = parts;
      if (!validTime(start || '') || !validTime(end || '') || start === end || !validTimeZone(timeZone || '')) {
        await respond('Usage: /quiet_hours <HH:MM> <HH:MM> <IANA timezone> or /quiet_hours off. Example: /quiet_hours 22:00 08:00 Africa/Nairobi'); return reply('ok');
      }
      settings.quietHours = { start, end, timeZone };
    }
    await saveSettings(env, settings);
    await respond(settings.quietHours ? `Quiet hours: ${settings.quietHours.start}–${settings.quietHours.end} (${settings.quietHours.timeZone}).` : 'Quiet hours off.');
    return reply('ok');
  }
  if (command === '/digest') {
    if (parts[0] === 'off') settings.dailyDigest = null;
    else {
      const [mode, time, timeZone] = parts;
      if (mode !== 'daily' || !validTime(time || '') || !validTimeZone(timeZone || '')) {
        await respond('Usage: /digest daily <HH:MM> <IANA timezone> or /digest off. Example: /digest daily 09:00 Africa/Nairobi'); return reply('ok');
      }
      settings.dailyDigest = { time, timeZone };
      settings.lastDigestDate = undefined;
    }
    await saveSettings(env, settings);
    await respond(settings.dailyDigest ? `Daily digest: ${settings.dailyDigest.time} (${settings.dailyDigest.timeZone}).` : 'Daily digest off. Pending items will send after quiet hours.');
    return reply('ok');
  }
  if (['/repo_event', '/repo_branches', '/repo_topic', '/repo_rules'].includes(command)) {
    const repo = (parts[0] || '').toLowerCase();
    if (!repoPattern.test(repo) || !settings.subscribedRepos.some(value => value.toLowerCase() === repo)) {
      await respond('Use a subscribed repository in owner/repo format. Run /repos to see subscriptions.'); return reply('ok');
    }
    if (command === '/repo_rules') {
      await respond(`<b>Rules for ${escape(repo)}</b>\n\n<pre>${escape(formatRepositoryRule(settings, repo))}</pre>`, true);
      return reply('ok');
    }
    if (command === '/repo_event') {
      const event = parts[1] as keyof ChatSettings['eventsEnabled'];
      const mode = parts[2] as 'on' | 'off' | 'inherit';
      if (!eventNames.includes(event) || !['on', 'off', 'inherit'].includes(mode)) {
        await respond('Usage: /repo_event owner/repo <event> <on|off|inherit>'); return reply('ok');
      }
      setRepositoryEvent(settings, repo, event, mode);
    } else if (command === '/repo_branches') {
      const branches = parts.slice(1);
      if (!branches.length) { await respond('Usage: /repo_branches owner/repo <branch...|all|inherit>'); return reply('ok'); }
      setRepositoryBranches(settings, repo, branches[0] === 'inherit' ? undefined : branches[0] === 'all' ? [] : branches);
    } else {
      const event = parts[1] as EventType;
      const value = parts[2];
      if (!topicNames.includes(event) || !value) { await respond('Usage: /repo_topic owner/repo <event|all> <here|topic-id|general|inherit>'); return reply('ok'); }
      let topic: number | null | undefined;
      if (value === 'inherit') topic = undefined;
      else if (value === 'general') topic = null;
      else if (value === 'here' && targetId === chat.id && thread) topic = thread;
      else if (/^[1-9]\d*$/.test(value)) topic = Number(value);
      else { await respond('Use here inside a topic, a positive topic ID, general, or inherit.'); return reply('ok'); }
      if (topic !== null && topic !== undefined && !Number.isSafeInteger(topic)) { await respond('Invalid topic ID.'); return reply('ok'); }
      setRepositoryTopic(settings, repo, event, topic);
    }
    await saveSettings(env, settings);
    await respond(`<b>Rules for ${escape(repo)}</b>\n\n<pre>${escape(formatRepositoryRule(settings, repo))}</pre>`, true);
    return reply('ok');
  }
  if (command === '/test') {
    const targetSettings = await getSettings(env, target);
    const connections = await env.DB.prepare('SELECT COUNT(*) AS total,SUM(verified) AS verified FROM connections WHERE chat_id=?')
      .bind(String(targetId)).first<{ total: number; verified: number | null }>();
    try {
      await send(env, targetId, `<b>✅ Test notification delivered</b>\n\nSubscriptions: <b>${targetSettings.subscribedRepos.length}</b>\nConfirmed webhooks: <b>${connections?.verified || 0}/${connections?.total || 0}</b>\n\nThis confirms Telegram delivery. A GitHub webhook is confirmed when its signed ping arrives.`, targetId === chat.id ? thread : undefined, true);
      if (targetId !== chat.id) await respond(`Test notification sent to chat ${targetId}.`);
    } catch (err) { console.error('Test delivery failed', err); await respond('Test delivery failed. Check the bot permissions and chat ID.'); }
    return reply('ok');
  }
  if (command === '/delivery_status') {
    const rows = await env.DB.prepare('SELECT repo,event_type,state,detail FROM delivery_status WHERE chat_id=? ORDER BY updated_at DESC LIMIT 5')
      .bind(String(targetId)).all<{ repo: string; event_type: string; state: string; detail: string }>();
    const details = rows.results.map(item => `• <code>${escape(item.repo)}</code> ${escape(item.event_type)}: <b>${escape(item.state)}</b>${item.detail ? ` (${escape(item.detail)})` : ''}`);
    await respond(`<b>Recent GitHub deliveries</b>\n\n${details.join('\n') || 'No deliveries recorded yet.'}`, true);
    return reply('ok');
  }
  if (command === '/failed_deliveries') {
    const rows = await env.DB.prepare('SELECT f.delivery_id,COALESCE(d.repo,\'digest\') AS repo,COALESCE(d.event_type,\'digest\') AS event_type,f.attempts FROM failed_jobs f LEFT JOIN delivery_status d ON d.chat_id=f.chat_id AND d.delivery_id=f.delivery_id WHERE f.chat_id=? ORDER BY f.failed_at DESC LIMIT 5')
      .bind(String(targetId)).all<{ delivery_id: string; repo: string; event_type: string; attempts: number }>();
    const lines = rows.results.map(item => `• <code>${escape(item.repo)}</code> ${escape(item.event_type)} · ${item.attempts} attempts`);
    await respond(`<b>Failed deliveries</b>\n\n${lines.join('\n') || 'No failed messages.'}${lines.length ? '\n\nUse /retry_failed to retry them.' : ''}`, true);
    return reply('ok');
  }
  if (command === '/retry_failed') {
    const rows = await env.DB.prepare('SELECT * FROM failed_jobs WHERE chat_id=? ORDER BY failed_at LIMIT 50')
      .bind(String(targetId)).all<Job & { last_error: string; failed_at: number }>();
    for (const job of rows.results) {
      await env.DB.batch([
        env.DB.prepare('INSERT OR IGNORE INTO jobs(delivery_id,chat_id,message,thread_id,silent,attempts,next_attempt_at,created_at) VALUES(?,?,?,?,?,0,?,?)')
          .bind(job.delivery_id, job.chat_id, job.message, job.thread_id, job.silent, Date.now(), Date.now()),
        env.DB.prepare('DELETE FROM failed_jobs WHERE delivery_id=? AND chat_id=?').bind(job.delivery_id, job.chat_id),
        env.DB.prepare("UPDATE delivery_status SET state='queued',detail='Manual retry',updated_at=? WHERE chat_id=? AND delivery_id=?")
          .bind(Date.now(), job.chat_id, job.delivery_id),
      ]);
    }
    await respond(`Queued ${rows.results.length} failed message(s) for retry.`);
    return reply('ok');
  }
  await respond('Unknown command. Use /help.');
  return reply('ok');
}

async function handleGitHub(request: Request, env: Env, chatId: string, scope: string): Promise<Response> {
  const conn = await env.DB.prepare('SELECT secret FROM connections WHERE chat_id=? AND owner=?').bind(chatId, scope).first<{ secret: string }>();
  if (!conn) return reply('Unknown connection', 404);
  const signature = request.headers.get('X-Hub-Signature-256') || '';
  if (!/^sha256=[0-9a-f]{64}$/i.test(signature)) return reply('Invalid signature', 401);
  const bytes = await request.arrayBuffer();
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(conn.secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const digest = Uint8Array.from(signature.slice(7).match(/../g)!, x => parseInt(x, 16));
  if (!(await crypto.subtle.verify('HMAC', key, digest, bytes))) return reply('Invalid signature', 401);
  const payload: any = JSON.parse(new TextDecoder().decode(bytes));
  const repo = String(payload.repository?.full_name || '').toLowerCase();
  if (!connectionMatches(scope, payload)) return reply('Webhook scope mismatch', 403);
  const eventName = request.headers.get('X-GitHub-Event') || '';
  await env.DB.prepare('UPDATE connections SET verified=1 WHERE chat_id=? AND owner=?').bind(chatId, scope).run();
  if (eventName === 'ping') {
    return reply('connected');
  }
  const deliveryId = request.headers.get('X-GitHub-Delivery') || '';
  if (!/^[0-9a-f-]{36}$/i.test(deliveryId)) return reply('Missing delivery ID', 400);
  const alreadySent = await env.DB.prepare('SELECT 1 FROM deliveries WHERE delivery_id=? AND chat_id=?').bind(deliveryId, chatId).first();
  if (alreadySent) return reply('already delivered');
  const sub = await env.DB.prepare('SELECT 1 FROM subscriptions WHERE chat_id=? AND repo=?').bind(chatId, repo).first();
  if (!sub) { await recordStatus(env, chatId, deliveryId, repo, eventName, 'filtered', 'Not subscribed'); return reply('not subscribed'); }
  const event = parseAndDispatchGitHubEvent(eventName, payload);
  if (!event) { await recordStatus(env, chatId, deliveryId, repo, eventName, 'filtered', 'Unsupported event'); return reply('ignored'); }
  const settings = await getSettings(env, { id: Number(chatId), type: 'supergroup' });
  const effective = effectiveSettings(settings, repo);
  if (event.eventType !== 'all' && !effective.eventsEnabled[event.eventType]) { await recordStatus(env, chatId, deliveryId, repo, eventName, 'disabled'); return reply('disabled'); }
  if (event.branchName && effective.branchFilter.length && !effective.branchFilter.some(x => x.endsWith('*') ? event.branchName!.startsWith(x.slice(0, -1)) : x === event.branchName)) {
    await recordStatus(env, chatId, deliveryId, repo, eventName, 'filtered', 'Branch filter'); return reply('filtered');
  }
  const alert = selectWorkflowAlert(event, effective);
  if (!alert) { await recordStatus(env, chatId, deliveryId, repo, eventName, 'filtered', 'Event action or alert mode'); return reply('ignored'); }
  if (shouldQueueDigest(effective, Boolean(alert.failureKey || alert.clearKey))) {
    await env.DB.batch([
      env.DB.prepare('INSERT OR IGNORE INTO digest_items(delivery_id,chat_id,message,created_at) VALUES(?,?,?,?)')
        .bind(deliveryId, chatId, digestItem(event.repoFullName, alert.message), Date.now()),
      env.DB.prepare('INSERT OR IGNORE INTO deliveries(delivery_id,chat_id,sent_at) VALUES(?,?,?)')
        .bind(deliveryId, chatId, Date.now()),
    ]);
    await recordStatus(env, chatId, deliveryId, repo, eventName, 'digest', 'Waiting for digest');
    return reply('queued for digest', 202);
  }
  const thread = effective.topics[event.eventType] === null ? null : effective.topics[event.eventType] ?? effective.topics.all ?? null;
  await env.DB.prepare('INSERT OR IGNORE INTO jobs(delivery_id,chat_id,message,thread_id,silent,created_at) VALUES(?,?,?,?,?,?)')
    .bind(deliveryId, chatId, alert.message, thread, settings.silent ? 1 : 0, Date.now()).run();
  await recordStatus(env, chatId, deliveryId, repo, eventName, 'queued');
  if (alert.failureKey || alert.clearKey) {
    recordWorkflowAlert(settings, alert);
    await saveSettings(env, settings);
  }
  return reply('queued', 202);
}

async function queueDueDigests(env: Env): Promise<void> {
  const rows = await env.DB.prepare('SELECT chat_id,settings FROM chats').all<{ chat_id: string; settings: string }>();
  for (const row of rows.results) {
    const settings = JSON.parse(row.settings) as ChatSettings;
    const due = digestDue(settings);
    if (!due.due) continue;
    const items = await env.DB.prepare('SELECT delivery_id,message FROM digest_items WHERE chat_id=? ORDER BY created_at LIMIT 200')
      .bind(row.chat_id).all<{ delivery_id: string; message: string }>();
    let offset = 0;
    for (const chunk of digestMessages(items.results.map(item => item.message))) {
      const batch = items.results.slice(offset, offset + chunk.count);
      const id = `digest-${batch[0].delivery_id}`;
      await env.DB.batch([
        env.DB.prepare('INSERT OR IGNORE INTO jobs(delivery_id,chat_id,message,thread_id,silent,created_at) VALUES(?,?,?,?,?,?)')
          .bind(id, row.chat_id, chunk.text, settings.topics.all ?? null, settings.silent ? 1 : 0, Date.now()),
        ...batch.map(item => env.DB.prepare('INSERT OR IGNORE INTO digest_job_items(job_id,chat_id,delivery_id) VALUES(?,?,?)').bind(id, row.chat_id, item.delivery_id)),
        ...batch.map(item => env.DB.prepare('DELETE FROM digest_items WHERE delivery_id=? AND chat_id=?').bind(item.delivery_id, row.chat_id)),
      ]);
      offset += chunk.count;
    }
    if (due.date) {
      const left = await env.DB.prepare('SELECT 1 FROM digest_items WHERE chat_id=? LIMIT 1').bind(row.chat_id).first();
      if (!left) { settings.lastDigestDate = due.date; await saveSettings(env, settings); }
    }
  }
}

async function drain(env: Env): Promise<void> {
  const now = Date.now();
  const rows = await env.DB.prepare('SELECT delivery_id,chat_id,message,thread_id,silent,attempts FROM jobs WHERE next_attempt_at<=? ORDER BY created_at LIMIT 12').bind(now).all<Job>();
  for (const job of rows.results) {
    const claim = await env.DB.prepare('UPDATE jobs SET next_attempt_at=? WHERE delivery_id=? AND chat_id=? AND next_attempt_at<=?')
      .bind(now + 5 * 60_000, job.delivery_id, job.chat_id, now).run();
    if (!claim.meta.changes) continue;
    try {
      await telegram(env, 'sendMessage', { chat_id: job.chat_id, text: job.message, parse_mode: 'HTML',
        ...(job.thread_id ? { message_thread_id: job.thread_id } : {}), disable_notification: Boolean(job.silent) });
      await env.DB.prepare('INSERT OR IGNORE INTO deliveries(delivery_id,chat_id,sent_at) VALUES(?,?,?)').bind(job.delivery_id, job.chat_id, Date.now()).run();
      await env.DB.prepare("UPDATE delivery_status SET state='delivered',detail='',updated_at=? WHERE chat_id=? AND (delivery_id=? OR delivery_id IN (SELECT delivery_id FROM digest_job_items WHERE job_id=? AND chat_id=?))")
        .bind(Date.now(), job.chat_id, job.delivery_id, job.delivery_id, job.chat_id).run();
      await env.DB.prepare('DELETE FROM digest_job_items WHERE job_id=? AND chat_id=?').bind(job.delivery_id, job.chat_id).run();
      await env.DB.prepare('DELETE FROM jobs WHERE delivery_id=? AND chat_id=?').bind(job.delivery_id, job.chat_id).run();
    } catch (err) {
      console.error('Telegram delivery failed', job.chat_id, err);
      if (job.attempts + 1 >= 8) {
        await env.DB.batch([
          env.DB.prepare('INSERT OR REPLACE INTO failed_jobs(delivery_id,chat_id,message,thread_id,silent,attempts,last_error,created_at,failed_at) SELECT delivery_id,chat_id,message,thread_id,silent,attempts+1,\'Telegram send failed\',created_at,? FROM jobs WHERE delivery_id=? AND chat_id=?')
            .bind(Date.now(), job.delivery_id, job.chat_id),
          env.DB.prepare("UPDATE delivery_status SET state='failed',detail='Moved to failed deliveries after 8 attempts',updated_at=? WHERE chat_id=? AND (delivery_id=? OR delivery_id IN (SELECT delivery_id FROM digest_job_items WHERE job_id=? AND chat_id=?))")
            .bind(Date.now(), job.chat_id, job.delivery_id, job.delivery_id, job.chat_id),
          env.DB.prepare('DELETE FROM jobs WHERE delivery_id=? AND chat_id=?').bind(job.delivery_id, job.chat_id),
        ]);
      } else {
        await env.DB.prepare("UPDATE delivery_status SET state='failed',detail='Retry scheduled',updated_at=? WHERE chat_id=? AND (delivery_id=? OR delivery_id IN (SELECT delivery_id FROM digest_job_items WHERE job_id=? AND chat_id=?))")
          .bind(Date.now(), job.chat_id, job.delivery_id, job.delivery_id, job.chat_id).run();
        const delay = Math.min(60 * 60_000, 2 ** Math.min(job.attempts, 10) * 60_000);
        await env.DB.prepare('UPDATE jobs SET attempts=attempts+1,next_attempt_at=? WHERE delivery_id=? AND chat_id=?')
          .bind(now + delay, job.delivery_id, job.chat_id).run();
      }
    }
  }
  await env.DB.prepare('DELETE FROM deliveries WHERE sent_at<?').bind(now - 7 * 86400_000).run();
  await env.DB.prepare('DELETE FROM delivery_status WHERE updated_at<?').bind(now - 7 * 86400_000).run();
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (url.pathname === '/health') return Response.json({ status: 'ok' });
      if (request.method !== 'POST') return reply('Not found', 404);
      if (url.pathname === '/telegram') return await handleTelegram(request, env);
      const match = url.pathname.match(/^\/github\/(-?\d+)\/([a-z0-9][a-z0-9-]*)(?:\/([a-z0-9._-]+))?$/i);
      if (match) {
        const scope = `${match[2]}${match[3] ? `/${match[3]}` : ''}`.toLowerCase();
        const res = await handleGitHub(request, env, match[1], scope);
        if (res.status === 202) ctx.waitUntil(drain(env));
        return res;
      }
      return reply('Not found', 404);
    } catch (err) { console.error(err); return reply('Internal error', 500); }
  },
  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> { await queueDueDigests(env); await drain(env); },
};
