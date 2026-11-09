import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export interface BotConfig {
  telegramToken: string;
  webhookSecret: string;
  port: number;
  baseUrl: string;
  dataDir: string;
  defaultVerbosity: 'compact' | 'detailed';
  chatRepoAllowlist: Record<string, string[]>;
}

export const config: BotConfig = {
  telegramToken: process.env.TELEGRAM_BOT_TOKEN || '',
  webhookSecret: process.env.WEBHOOK_SECRET || '',
  port: parseInt(process.env.PORT || '3000', 10),
  baseUrl: process.env.BASE_URL || 'http://localhost:3000',
  dataDir: process.env.DATA_DIR || path.join(process.cwd(), 'data'),
  defaultVerbosity: (process.env.DEFAULT_VERBOSITY === 'compact' ? 'compact' : 'detailed'),
  chatRepoAllowlist: JSON.parse(process.env.CHAT_REPO_ALLOWLIST || '{}'),
};

export function validateConfig(): void {
  if (!config.telegramToken) {
    throw new Error('TELEGRAM_BOT_TOKEN is required');
  }
  if (!config.webhookSecret || config.webhookSecret === 'your_github_webhook_secret_here') {
    throw new Error('WEBHOOK_SECRET is required');
  }
  if (!config.chatRepoAllowlist || typeof config.chatRepoAllowlist !== 'object' || Array.isArray(config.chatRepoAllowlist) ||
      Object.values(config.chatRepoAllowlist).some((repos) => !Array.isArray(repos) || repos.some((repo) => typeof repo !== 'string'))) {
    throw new Error('CHAT_REPO_ALLOWLIST must be a JSON object mapping chat IDs to repository lists');
  }
}
