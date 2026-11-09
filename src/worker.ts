import { parseAndDispatchGitHubEvent } from './github/dispatcher.js';
import type { ChatSettings, EventType } from './types/store.js';
import type { D1Database, ExecutionContext, ScheduledEvent } from '@cloudflare/workers-types';

interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
}
type TgChat = { id: number; type: string; title?: string; is_forum?: boolean };
type TgUpdate = { message?: { chat: TgChat; from?: { id: number }; text?: string; message_thread_id?: number }; channel_post?: { chat: TgChat; from?: { id: number }; text?: string; message_thread_id?: number }; callback_query?: { id: string; from: { id: number }; message?: { chat: TgChat; message_id: number; message_thread_id?: number }; data?: string } };
type Job = { delivery_id: string; chat_id: string; message: string; thread_id: number | null; silent: number; attempts: number };

const events: EventType[] = ['all', 'pushes', 'prs', 'issues', 'comments', 'releases', 'workflows', 'stars', 'forks'];
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
    eventsEnabled: { pushes: true, prs: true, issues: true, comments: false, releases: true, workflows: false, stars: true, forks: true },
    branchFilter: [], verbosity: 'detailed', silent: false, createdAt: now, updatedAt: now };
}

async function getSettings(env: Env, chat: TgChat): Promise<ChatSettings> {
  const row = await env.DB.prepare('SELECT settings FROM chats WHERE chat_id=?').bind(String(chat.id)).first<{ settings: string }>();
  return row ? JSON.parse(row.settings) : defaultSettings(chat);
}

async function saveSettings(env: Env, settings: ChatSettings): Promise<void> {
  settings.updatedAt = new Date().toISOString();
  await env.DB.prepare('INSERT INTO chats(chat_id,settings,updated_at) VALUES(?,?,?) ON CONFLICT(chat_id) DO UPDATE SET settings=excluded.settings,updated_at=excluded.updated_at')
    .bind(String(settings.chatId), JSON.stringify(settings), Date.now()).run();
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
    await telegram(env, 'answerCallbackQuery', { callback_query_id: update.callback_query.id });
    return reply('ok');
  }
  if (!msg?.text) return reply('ok');
  const parts = msg.text.trim().split(/\s+/);
  const command = parts.shift()?.split('@')[0].toLowerCase();
  if (!command?.startsWith('/')) return reply('ok');
  const userId = msg.from?.id;
  const chat = msg.chat;
  const thread = msg.message_thread_id;
  const isPrivate = chat.type === 'private';
  const targetId = isPrivate && /^-?\d+$/.test(parts[0] || '') ? Number(parts.shift()) : chat.id;
  const target: TgChat = targetId === chat.id ? chat : { id: targetId, type: 'supergroup' };
  const respond = (text: string, html = false) => send(env, chat.id, text, thread, html);

  if (command === '/start' && isPrivate && /^connect_-?\d+$/.test(parts[0] || '')) {
    const linkedChatId = parts[0].slice('connect_'.length);
    await respond(`<b>Connect chat ${escape(linkedChatId)}</b>\n\nChoose what to follow:\n• One repository: <code>/connect ${escape(linkedChatId)} owner/repo</code>\n• An organization: <code>/connect ${escape(linkedChatId)} organization</code>\n\nI’ll send the GitHub webhook URL and secret here, privately.`, true);
    return reply('ok');
  }
  if (command === '/start' || command === '/help') {
    await respond('<b>GitHub notifications setup</b>\n\n1. Add me to your group or channel.\n2. Send <code>/status</code> there to get its chat ID.\n3. Message me privately: <code>/connect CHAT_ID owner/repo</code> for one repository, or <code>/connect CHAT_ID organization</code> for an entire organization.\n4. Add the GitHub webhook using the URL and secret I send you.\n5. Subscribe with <code>/subscribe owner/repo</code>.\n\nOther commands: <code>/settings</code>, <code>/repos</code>, <code>/set_topic pushes</code>, <code>/filter_branches main</code>.', true);
    return reply('ok');
  }
  if (command === '/status' || command === '/settings') {
    const settings = await getSettings(env, chat);
    const owners = await env.DB.prepare('SELECT owner,verified FROM connections WHERE chat_id=?').bind(String(chat.id)).all<{ owner: string; verified: number }>();
    const connections = owners.results.map((x: { owner: string; verified: number }) => `• ${escape(x.owner)} ${x.verified ? '✅ webhook confirmed' : '⏳ webhook not confirmed'}`).join('\n') || 'None yet';
    const repos = settings.subscribedRepos.map(x => `• ${escape(x)}`).join('\n') || 'None yet';
    await respond(`<b>${command === '/status' ? 'Connection status' : 'Settings'}</b>\n\n<b>Chat ID:</b> <code>${chat.id}</code>\n\n<b>Connections</b>\n${connections}\n\n<b>Subscribed repositories</b>\n${repos}\n\n<b>Next step:</b> ${owners.results.length ? 'Use <code>/subscribe owner/repo</code> to follow a repository. If the webhook is unconfirmed, check GitHub’s Recent Deliveries.' : `Message me privately: <code>/connect ${chat.id} owner/repo</code> (one repo) or <code>/connect ${chat.id} organization</code> (all repos in an organization).`}`, true);
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
    } else {
      await env.DB.prepare('DELETE FROM subscriptions WHERE chat_id=? AND repo LIKE ?').bind(String(targetId), `${scope}/%`).run();
      settings.subscribedRepos = settings.subscribedRepos.filter(x => !x.toLowerCase().startsWith(`${scope}/`));
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
  if (!sub) return reply('not subscribed');
  const event = parseAndDispatchGitHubEvent(eventName, payload);
  if (!event) return reply('ignored');
  const settings = await getSettings(env, { id: Number(chatId), type: 'supergroup' });
  if (event.eventType !== 'all' && !settings.eventsEnabled[event.eventType]) return reply('disabled');
  if (event.branchName && settings.branchFilter.length && !settings.branchFilter.some(x => x.endsWith('*') ? event.branchName!.startsWith(x.slice(0, -1)) : x === event.branchName)) return reply('filtered');
  const message = event.format(settings.verbosity);
  if (!message) return reply('ignored');
  const thread = settings.topics[event.eventType] ?? settings.topics.all ?? null;
  await env.DB.prepare('INSERT OR IGNORE INTO jobs(delivery_id,chat_id,message,thread_id,silent,created_at) VALUES(?,?,?,?,?,?)')
    .bind(deliveryId, chatId, message, thread, settings.silent ? 1 : 0, Date.now()).run();
  return reply('queued', 202);
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
      await env.DB.prepare('DELETE FROM jobs WHERE delivery_id=? AND chat_id=?').bind(job.delivery_id, job.chat_id).run();
    } catch (err) {
      console.error('Telegram delivery failed', job.chat_id, err);
      const delay = Math.min(60 * 60_000, 2 ** Math.min(job.attempts, 10) * 60_000);
      await env.DB.prepare('UPDATE jobs SET attempts=attempts+1,next_attempt_at=? WHERE delivery_id=? AND chat_id=?')
        .bind(now + delay, job.delivery_id, job.chat_id).run();
    }
  }
  await env.DB.prepare('DELETE FROM deliveries WHERE sent_at<?').bind(now - 7 * 86400_000).run();
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
  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> { await drain(env); },
};
