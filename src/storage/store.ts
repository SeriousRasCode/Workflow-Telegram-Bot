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
  private data: StoreData = { chats: {}, deliveries: {}, version: 2 };

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
        this.data.deliveries ||= {};
        // Earlier versions subscribed every chat to every repository implicitly.
        for (const chat of Object.values(this.data.chats)) {
          chat.subscribedRepos = (chat.subscribedRepos || []).filter((repo) => repo !== '*');
        }
      }
    } catch (err) {
      throw new Error(`Failed to load settings file ${this.filePath}`, { cause: err });
    }
  }

  public save(): void {
    try {
      const tempPath = `${this.filePath}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(this.data, null, 2), 'utf-8');
      fs.renameSync(tempPath, this.filePath);
    } catch (err) {
      throw new Error(`Failed to save settings file ${this.filePath}`, { cause: err });
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
        subscribedRepos: [],
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

  public wasDelivered(deliveryId: string, chatId: number): boolean {
    return Boolean(this.data.deliveries?.[deliveryId]?.[chatId]);
  }

  public recordDelivery(deliveryId: string, chatId: number): void {
    const deliveries = this.data.deliveries ||= {};
    deliveries[deliveryId] ||= {};
    deliveries[deliveryId][chatId] = Date.now();
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const [id, chats] of Object.entries(deliveries)) {
      if (Object.values(chats).every((time) => time < cutoff)) delete deliveries[id];
    }
    this.save();
  }

  public getChatsForRepo(repoFullName: string): ChatSettings[] {
    const lowerRepo = repoFullName.toLowerCase();
    return this.getAllChats().filter((chat) => {
      return (
        this.isRepoAllowed(chat.chatId, repoFullName) &&
        chat.subscribedRepos.some((r) => r.toLowerCase() === lowerRepo)
      );
    });
  }

  public isRepoAllowed(chatId: number, repoFullName: string): boolean {
    const repo = repoFullName.toLowerCase();
    return (config.chatRepoAllowlist[String(chatId)] || []).some((allowed) => {
      const rule = allowed.toLowerCase();
      return rule === repo || (rule.endsWith('/*') && repo.startsWith(rule.slice(0, -1)));
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
    if (!/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+$/.test(cleaned) || cleaned.includes('..')) {
      throw new Error('Repository must be in owner/repo format');
    }
    if (!this.isRepoAllowed(chatId, cleaned)) {
      throw new Error('This repository is not approved for this chat');
    }
    if (!chat.subscribedRepos.some((r) => r.toLowerCase() === cleaned.toLowerCase())) {
      chat.subscribedRepos.push(cleaned);
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
