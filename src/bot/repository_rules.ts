import type { ChatSettings, ChatEventsEnabled, EventType, RepositoryRule } from '../types/store.js';

export const eventNames: (keyof ChatEventsEnabled)[] = ['pushes', 'prs', 'reviews', 'issues', 'comments', 'releases', 'workflows', 'stars', 'forks'];
export const topicNames: EventType[] = ['all', ...eventNames];

export function effectiveSettings(chat: ChatSettings, repo: string): ChatSettings {
  const rule = chat.repositoryRules?.[repo.toLowerCase()];
  if (!rule) return chat;
  const topics = { ...chat.topics };
  if (rule.topics?.all !== undefined) {
    for (const event of eventNames) topics[event] = rule.topics[event] === undefined ? rule.topics.all : rule.topics[event];
  }
  Object.assign(topics, rule.topics);
  return {
    ...chat,
    eventsEnabled: { ...chat.eventsEnabled, ...rule.eventsEnabled },
    branchFilter: rule.branchFilter === undefined ? chat.branchFilter : rule.branchFilter,
    topics,
  };
}

export function repositoryRule(chat: ChatSettings, repo: string): RepositoryRule {
  const key = repo.toLowerCase();
  return (chat.repositoryRules ||= {})[key] ||= {};
}

export function setRepositoryEvent(chat: ChatSettings, repo: string, event: keyof ChatEventsEnabled, mode: 'on' | 'off' | 'inherit'): void {
  const rule = repositoryRule(chat, repo);
  if (mode === 'inherit') delete rule.eventsEnabled?.[event];
  else (rule.eventsEnabled ||= {})[event] = mode === 'on';
}

export function setRepositoryBranches(chat: ChatSettings, repo: string, branches: string[] | undefined): void {
  const rule = repositoryRule(chat, repo);
  if (branches === undefined) delete rule.branchFilter;
  else rule.branchFilter = branches;
}

export function setRepositoryTopic(chat: ChatSettings, repo: string, event: EventType, thread: number | null | undefined): void {
  const rule = repositoryRule(chat, repo);
  if (thread === undefined) delete rule.topics?.[event];
  else (rule.topics ||= {})[event] = thread;
}

export function formatRepositoryRule(chat: ChatSettings, repo: string): string {
  const rule = chat.repositoryRules?.[repo.toLowerCase()];
  if (!rule) return 'Uses chat defaults.';
  const events = Object.entries(rule.eventsEnabled || {}).map(([key, value]) => `${key}: ${value ? 'on' : 'off'}`).join(', ') || 'chat defaults';
  const branches = rule.branchFilter === undefined ? 'chat defaults' : rule.branchFilter.join(', ') || 'all branches';
  const topics = Object.entries(rule.topics || {}).map(([key, value]) => `${key}: ${value ?? 'general'}`).join(', ') || 'chat defaults';
  return `Events: ${events}\nBranches: ${branches}\nTopics: ${topics}`;
}
