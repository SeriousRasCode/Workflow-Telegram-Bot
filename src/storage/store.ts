import fs from 'fs';
import path from 'path';
import { ChatSettings, StoreData, EventType, ChatEventsEnabled } from '../types/store.js';
import { config } from '../config.js';

const DEFAULT_EVENTS_ENABLED: ChatEventsEnabled = {
  pushes: true,
  prs: true,
  issues: true,
  comments: false, // off by default to avoid high frequency notification spam
  releases: true,
  workflows: false, // off by default
  stars: true,
  forks: true,
};

export class SettingsStore {
  private filePath: string;
  private data: StoreData = { chats: {}, version: 1 };
  private saveTimeout: NodeJS.Timeout | null = null;

  constructor(dataDir: string = config.dataDir) {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    this.filePath = path.join(dataDir, 'settings.json');
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        this.data = JSON.parse(raw);
        if (!this.data.chats) {
          this.data.chats = {};
        }
      }
    } catch (err) {
      console.error('Failed to load settings file, initializing clean store:', err);
      this.data = { chats: {}, version: 1 };
    }
  }

  public save(): void {
    try {
      const tempPath = `${this.filePath}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(this.data, null, 2), 'utf-8');
      fs.renameSync(tempPath, this.filePath);
    } catch (err) {
      console.error('Failed to save settings:', err);
    }
  }

  public getOrCreateChat(chatId: number, chatTitle: string = 'Unknown Chat', isForum: boolean = false): ChatSettings {
    const key = chatId.toString();
    if (!this.data.chats[key]) {
      const now = new Date().toISOString();
      this.data.chats[key] = {
        chatId,
        chatTitle,
        isForum,
        subscribedRepos: ['*'], // Default to all webhooks sent to this bot instance
        topics: {},
        topicNames: {},
        eventsEnabled: { ...DEFAULT_EVENTS_ENABLED },
        branchFilter: [],
        verbosity: config.defaultVerbosity,
        silent: false,
        createdAt: now,
        updatedAt: now,
      };
      this.save();
    } else {
      let changed = false;
      if (chatTitle && this.data.chats[key].chatTitle !== chatTitle) {
        this.data.chats[key].chatTitle = chatTitle;
        changed = true;
      }
      if (isForum !== undefined && this.data.chats[key].isForum !== isForum) {
        this.data.chats[key].isForum = isForum;
        changed = true;
      }
      if (changed) {
        this.save();
      }
    }
    return this.data.chats[key];
  }

  public getChat(chatId: number): ChatSettings | undefined {
    return this.data.chats[chatId.toString()];
  }

  public getAllChats(): ChatSettings[] {
    return Object.values(this.data.chats);
  }

  public getChatsForRepo(repoFullName: string): ChatSettings[] {
    const lowerRepo = repoFullName.toLowerCase();
    return this.getAllChats().filter((chat) => {
      return (
        chat.subscribedRepos.includes('*') ||
        chat.subscribedRepos.some((r) => r.toLowerCase() === lowerRepo)
      );
    });
  }

  public updateChat(chatId: number, partial: Partial<ChatSettings>): ChatSettings {
    const chat = this.getOrCreateChat(chatId);
    Object.assign(chat, partial, { updatedAt: new Date().toISOString() });
    this.save();
    return chat;
  }

  public setTopic(
    chatId: number,
    eventType: EventType,
    threadId: number | null,
    topicName?: string
  ): ChatSettings {
    const chat = this.getOrCreateChat(chatId);
    if (!chat.topics) chat.topics = {};
    if (!chat.topicNames) chat.topicNames = {};

    if (eventType === 'all') {
      chat.topics.all = threadId;
    } else {
      chat.topics[eventType] = threadId;
    }

    if (threadId !== null && topicName) {
      chat.topicNames[threadId.toString()] = topicName;
    }

    chat.updatedAt = new Date().toISOString();
    this.save();
    return chat;
  }

  public unsetTopic(chatId: number, eventType: EventType): ChatSettings {
    const chat = this.getOrCreateChat(chatId);
    if (eventType === 'all') {
      delete chat.topics.all;
    } else {
      delete chat.topics[eventType];
    }
    chat.updatedAt = new Date().toISOString();
    this.save();
    return chat;
  }

  public subscribeRepo(chatId: number, repoFullName: string): boolean {
    const chat = this.getOrCreateChat(chatId);
    const cleaned = repoFullName.trim();
    if (!chat.subscribedRepos.some((r) => r.toLowerCase() === cleaned.toLowerCase())) {
      // If user had wildcard '*', we can keep or replace depending on preference
      // Here, if they add a specific repo, remove '*' if present and it's their first explicit repo
      if (chat.subscribedRepos.length === 1 && chat.subscribedRepos[0] === '*') {
        chat.subscribedRepos = [cleaned];
      } else {
        chat.subscribedRepos.push(cleaned);
      }
      chat.updatedAt = new Date().toISOString();
      this.save();
      return true;
    }
    return false;
  }

  public unsubscribeRepo(chatId: number, repoFullName: string): boolean {
    const chat = this.getOrCreateChat(chatId);
    const cleaned = repoFullName.trim().toLowerCase();
    const prevLength = chat.subscribedRepos.length;
    chat.subscribedRepos = chat.subscribedRepos.filter((r) => r.toLowerCase() !== cleaned);
    if (chat.subscribedRepos.length === 0) {
      // If none left, default back to wildcard or empty
      chat.subscribedRepos = [];
    }
    if (chat.subscribedRepos.length !== prevLength) {
      chat.updatedAt = new Date().toISOString();
      this.save();
      return true;
    }
    return false;
  }

  public toggleEvent(chatId: number, eventKey: keyof ChatEventsEnabled): boolean {
    const chat = this.getOrCreateChat(chatId);
    chat.eventsEnabled[eventKey] = !chat.eventsEnabled[eventKey];
    chat.updatedAt = new Date().toISOString();
    this.save();
    return chat.eventsEnabled[eventKey];
  }

  public setVerbosity(chatId: number, verbosity: 'compact' | 'detailed'): void {
    const chat = this.getOrCreateChat(chatId);
    chat.verbosity = verbosity;
    chat.updatedAt = new Date().toISOString();
    this.save();
  }

  public toggleSilent(chatId: number): boolean {
    const chat = this.getOrCreateChat(chatId);
    chat.silent = !chat.silent;
    chat.updatedAt = new Date().toISOString();
    this.save();
    return chat.silent;
  }

  public setBranchFilter(chatId: number, branches: string[]): void {
    const chat = this.getOrCreateChat(chatId);
    chat.branchFilter = branches.map((b) => b.trim()).filter(Boolean);
    chat.updatedAt = new Date().toISOString();
    this.save();
  }
}

export const store = new SettingsStore();
