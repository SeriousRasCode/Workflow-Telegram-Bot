export type EventType =
  | 'all'
  | 'pushes'
  | 'prs'
  | 'issues'
  | 'comments'
  | 'releases'
  | 'workflows'
  | 'stars'
  | 'forks';

export interface ChatTopicSettings {
  all?: number | null;
  pushes?: number | null;
  prs?: number | null;
  issues?: number | null;
  comments?: number | null;
  releases?: number | null;
  workflows?: number | null;
  stars?: number | null;
  forks?: number | null;
}

export interface ChatEventsEnabled {
  pushes: boolean;
  prs: boolean;
  issues: boolean;
  comments: boolean;
  releases: boolean;
  workflows: boolean;
  stars: boolean;
  forks: boolean;
}

export interface ChatSettings {
  chatId: number;
  chatTitle: string;
  isForum?: boolean;
  subscribedRepos: string[]; // ['owner/repo', ...] or ['*'] for all
  topics: ChatTopicSettings;
  topicNames: Record<string, string>; // threadId -> topic title
  eventsEnabled: ChatEventsEnabled;
  branchFilter: string[]; // e.g. ['main', 'master'], empty array means all branches
  verbosity: 'compact' | 'detailed';
  silent: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StoreData {
  chats: Record<string, ChatSettings>; // key: chatId string
  version: number;
}
