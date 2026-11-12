import type { ChatSettings, EventType } from '../types/store.js';

export type MenuView = 'home' | 'repos' | 'events' | 'topics' | 'prefs' | 'connections';
export type MenuButton = { text: string; callback_data: string } | { text: string; url: string };
export type Menu = { text: string; reply_markup: { inline_keyboard: MenuButton[][] } };
export type ConnectionSummary = { owner: string; verified: number };

const eventLabels: Record<Exclude<EventType, 'all'>, string> = {
    pushes: 'Pushes', prs: 'Pull requests', reviews: 'PR reviews', issues: 'Issues', comments: 'Comments',
  releases: 'Releases', workflows: 'Workflows', stars: 'Stars', forks: 'Forks',
};
const esc = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const button = (id: number, label: string, action: string): MenuButton => ({ text: label, callback_data: `m:${id}:${action}` });
const back = (id: number): MenuButton[] => [button(id, '← Main menu', 'home')];

export function repoKey(repo: string): string {
  let hash = 2166136261;
  for (const char of repo.toLowerCase()) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(36);
}

export function buildMenu(view: MenuView, chat: ChatSettings, connections: ConnectionSummary[], threadId?: number): Menu {
  const id = chat.chatId;
  const rows: MenuButton[][] = [];
  let text = '';
  if (view === 'home') {
    text = `<b>⚙️ ${esc(chat.chatTitle || 'Chat')} settings</b>\n\n` +
      `Repositories: <b>${chat.subscribedRepos.length}</b> · Connections: <b>${connections.length}</b>\n` +
      `Choose what to manage below.`;
    rows.push([button(id, '📦 Repositories', 'repos'), button(id, '🔔 Events', 'events')]);
    rows.push([button(id, '🎯 Topics', 'topics'), button(id, '⚙️ Preferences', 'prefs')]);
    rows.push([button(id, '🔗 Connections', 'connections')]);
    if (threadId) rows.push([button(id, `Assign this topic #${threadId}`, `topics:${threadId}`)]);
    rows.push([button(id, '↻ Refresh', 'home')]);
  } else if (view === 'repos') {
    text = `<b>📦 Repositories</b>\n\n${chat.subscribedRepos.length ? chat.subscribedRepos.map(r => `• <code>${esc(r)}</code>`).join('\n') : 'None subscribed yet.'}` +
      `\n\nTo add one, send <code>/subscribe owner/repo</code> in this chat. For a channel, you can also DM the bot <code>/subscribe ${id} owner/repo</code>.` +
      '\nFor overrides, use <code>/repo_rules owner/repo</code>, <code>/repo_event</code>, <code>/repo_branches</code>, or <code>/repo_topic</code>.';
    chat.subscribedRepos.slice(0, 12).forEach((repo, index) => rows.push([button(id, `Remove ${repo.slice(0, 28)}`, `unsub:${index}:${repoKey(repo)}`)]));
    rows.push(back(id));
  } else if (view === 'events') {
    text = '<b>🔔 Event notifications</b>\n\nTap an event to turn its notifications on or off.';
    const entries = Object.entries(eventLabels) as [Exclude<EventType, 'all'>, string][];
    for (let i = 0; i < entries.length; i += 2) {
      rows.push(entries.slice(i, i + 2).map(([key, label]) => button(id, `${chat.eventsEnabled[key] ? '✅' : '❌'} ${label}`, `event:${key}`)));
    }
    rows.push(back(id));
  } else if (view === 'topics') {
    text = `<b>🎯 Topic routing</b>\n\n${Object.entries(chat.topics).map(([event, topic]) => `• ${esc(event)} → ${topic ?? 'General'}`).join('\n') || 'No custom routes. Events go to the general chat.'}`;
    Object.keys(chat.topics).forEach(event => rows.push([button(id, `Clear ${event} route`, `untopic:${event}`)]));
    if (threadId) {
      text += `\n\n<b>Assign current topic #${threadId}</b> to:`;
      const options: EventType[] = ['all', 'pushes', 'prs', 'issues', 'comments', 'releases', 'workflows', 'stars', 'forks'];
      for (let i = 0; i < options.length; i += 3) {
        rows.push(options.slice(i, i + 3).map(event => button(id, event === 'all' ? 'All' : eventLabels[event], `topic:${threadId}:${event}`)));
      }
    } else {
      text += '\n\nOpen <code>/menu</code> inside a forum topic to assign it with buttons. You can also use <code>/set_topic pushes</code> there.';
    }
    rows.push(back(id));
  } else if (view === 'prefs') {
    text = `<b>⚙️ Preferences</b>\n\nMessage style: <b>${chat.verbosity}</b>\nSilent notifications: <b>${chat.silent ? 'On' : 'Off'}</b>\nBranch filter: <b>${chat.branchFilter.length ? chat.branchFilter.map(esc).join(', ') : 'All branches'}</b>` +
      `\nWorkflow alerts: <b>${chat.workflowAlerts === 'failures' ? 'Failures and recovery' : 'All completions'}</b>` +
      `\nQuiet hours: <b>${chat.quietHours ? `${esc(chat.quietHours.start)}–${esc(chat.quietHours.end)} ${esc(chat.quietHours.timeZone)}` : 'Off'}</b>` +
      `\nDaily digest: <b>${chat.dailyDigest ? `${esc(chat.dailyDigest.time)} ${esc(chat.dailyDigest.timeZone)}` : 'Off'}</b>` +
      '\n\nSet with <code>/quiet_hours 22:00 08:00 Africa/Nairobi</code> and <code>/digest daily 09:00 Africa/Nairobi</code>. Send <code>/quiet_hours off</code> or <code>/digest off</code> to disable.';
    rows.push([button(id, `Style: ${chat.verbosity}`, 'verbosity'), button(id, `Silent: ${chat.silent ? 'On' : 'Off'}`, 'silent')]);
    rows.push([button(id, `CI: ${chat.workflowAlerts === 'failures' ? 'Failures' : 'All runs'}`, 'workflow')]);
    rows.push(back(id));
  } else {
    text = `<b>🔗 GitHub connections</b>\n\n${connections.length ? connections.map(c => `• <code>${esc(c.owner)}</code> ${c.verified ? '✅ confirmed' : '⏳ unconfirmed'}`).join('\n') : 'No connections yet.'}` +
      `\n\nTo connect a repository or organization, DM the bot <code>/connect ${id} owner/repo</code> or <code>/connect ${id} organization</code>. The webhook secret is only sent privately.`;
    connections.slice(0, 12).forEach((connection, index) => {
      if (connection.owner.includes('/') && !chat.subscribedRepos.includes(connection.owner)) {
        rows.push([button(id, `Follow ${connection.owner.slice(0, 28)}`, `sub:${index}:${repoKey(connection.owner)}`)]);
      }
    });
    rows.push(back(id));
  }
  return { text, reply_markup: { inline_keyboard: rows } };
}
