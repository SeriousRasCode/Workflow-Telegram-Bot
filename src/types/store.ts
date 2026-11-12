export type EventType =
  | 'all'
  | 'pushes'
  | 'prs'
  | 'reviews'
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
  reviews?: number | null;
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
  reviews: boolean;
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
  subscribedRepos: string[]; // Explicit owner/repo subscriptions
  repositoryRules?: Record<string, RepositoryRule>;
  topics: ChatTopicSettings;
  topicNames: Record<string, string>; // threadId -> topic title
  eventsEnabled: ChatEventsEnabled;
  branchFilter: string[]; // e.g. ['main', 'master'], empty array means all branches
  verbosity: 'compact' | 'detailed';
  workflowAlerts?: 'all' | 'failures';
  workflowFailures?: Record<string, boolean>;
  quietHours?: { start: string; end: string; timeZone: string } | null;
  dailyDigest?: { time: string; timeZone: string } | null;
  lastDigestDate?: string;
  silent: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RepositoryRule {
  eventsEnabled?: Partial<ChatEventsEnabled>;
  branchFilter?: string[];
  topics?: ChatTopicSettings;
}

export interface StoreData {
  chats: Record<string, ChatSettings>; // key: chatId string
  deliveries?: Record<string, Record<string, number>>; // delivery ID -> chat ID -> timestamp
  digestItems?: Record<string, string[]>;
  deliveryStatus?: Record<string, DeliveryStatus[]>;
  failedDeliveries?: Record<string, FailedDelivery[]>;
  userChatContexts?: Record<string, number>;
  version: number;
}

export interface DeliveryStatus {
  deliveryId: string;
  repo: string;
  eventType: string;
  state: 'delivered' | 'queued' | 'digest' | 'filtered' | 'disabled' | 'failed';
  detail?: string;
  updatedAt: string;
}

export interface FailedDelivery {
  deliveryId: string;
  repo: string;
  eventType: string;
  message: string;
  threadId?: number;
  silent: boolean;
  attempts: number;
  lastError: string;
  updatedAt: string;
}
