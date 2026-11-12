import { config, validateConfig } from './config.js';
import { bot } from './bot/instance.js';
import { registerBotCommands } from './bot/commands.js';
import { createServer } from './server/app.js';
import { store } from './storage/store.js';
import { flushDigests } from './github/notifier.js';

async function bootstrap() {
  console.log('🚀 Starting GitHub Webhook Telegram Bot...');
  validateConfig();

  // 1. Initialize Express Webhook Server
  const app = createServer();
  const server = app.listen(config.port, () => {
    console.log(`📡 GitHub Webhook server listening on port ${config.port}`);
    console.log(`🌐 Webhook endpoint: ${config.baseUrl}/webhook`);
    console.log(`🩺 Health check: ${config.baseUrl}/health`);
  });

  // 2. Initialize Telegram Bot
  if (config.telegramToken && config.telegramToken !== 'placeholder_token') {
    registerBotCommands(bot);

    // Set Telegram Bot UI Command Menu
    try {
      await bot.api.setMyCommands([
        { command: 'settings', description: 'Interactive settings & topic configuration' },
        { command: 'status', description: 'View current topic routing & bot status' },
        { command: 'set_topic', description: 'Assign current topic for an event (/set_topic <event>)' },
        { command: 'unset_topic', description: 'Clear topic assignment for an event' },
        { command: 'subscribe', description: 'Subscribe chat to repository (/subscribe <owner/repo>)' },
        { command: 'unsubscribe', description: 'Unsubscribe from repository' },
        { command: 'repos', description: 'List subscribed repositories' },
        { command: 'filter_branches', description: 'Set branch filter for push events' },
        { command: 'workflow_alerts', description: 'Choose all CI runs or failures and recovery' },
        { command: 'quiet_hours', description: 'Pause routine alerts during set hours' },
        { command: 'digest', description: 'Set a daily activity digest' },
        { command: 'test', description: 'Send a test notification' },
        { command: 'delivery_status', description: 'Show recent delivery outcomes' },
        { command: 'repo_rules', description: 'Show rules for one repository' },
        { command: 'repo_event', description: 'Override an event for one repository' },
        { command: 'repo_branches', description: 'Override branches for one repository' },
        { command: 'repo_topic', description: 'Override topic routing for one repository' },
        { command: 'toggle_event', description: 'Toggle a GitHub event (/toggle_event reviews)' },
        { command: 'help', description: 'Show bot usage instructions' },
      ]);
      console.log('✅ Telegram bot command menu registered.');
    } catch (err: any) {
      console.warn('⚠️ Could not set bot commands in Telegram UI:', err.message);
    }

    // Start long-polling
    bot.start({
      onStart: (botInfo) => {
        console.log(`🤖 Telegram bot @${botInfo.username} is running and ready for messages!`);
      },
    });
    const digestTimer = setInterval(() => { void flushDigests(); }, 60_000);
    digestTimer.unref();
  } else {
    console.log('------------------------------------------------------------------------');
    console.log('ℹ️ Bot token not configured yet.');
    console.log('   Create a .env file from .env.example and set TELEGRAM_BOT_TOKEN.');
    console.log('   The webhook HTTP server is active and receiving webhooks.');
    console.log('------------------------------------------------------------------------');
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n🛑 Received ${signal}. Shutting down gracefully...`);
    store.save();
    server.close(() => {
      console.log('HTTP server closed.');
    });
    if (bot.isRunning()) {
      await bot.stop();
      console.log('Telegram bot stopped.');
    }
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  console.error('Fatal initialization error:', err);
  process.exit(1);
});
