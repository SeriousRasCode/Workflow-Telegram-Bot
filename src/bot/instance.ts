import { Bot } from 'grammy';
import { config } from '../config.js';

if (!config.telegramToken) {
  console.warn('⚠️ No TELEGRAM_BOT_TOKEN provided. Telegram bot will not start polling until a token is set in .env.');
}

export const bot = new Bot(config.telegramToken || 'placeholder_token');

bot.catch((err) => {
  const ctx = err.ctx;
  console.error(`Error while handling update ${ctx.update.update_id}:`, err.error);
});
