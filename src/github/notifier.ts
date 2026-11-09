import { bot } from '../bot/instance.js';
import { store } from '../storage/store.js';
import { DispatchedEvent } from './dispatcher.js';

export async function broadcastGitHubEvent(event: DispatchedEvent): Promise<number> {
  const targetChats = store.getChatsForRepo(event.repoFullName);
  if (targetChats.length === 0) {
    console.log(`ℹ️ No chats subscribed to repository "${event.repoFullName}" (total known chats: ${store.getAllChats().length})`);
    return 0;
  }

  let deliveredCount = 0;

  for (const chat of targetChats) {
    // 1. Check if event is enabled for this chat
    if (event.eventType !== 'all') {
      const isEnabled = chat.eventsEnabled[event.eventType];
      if (!isEnabled) {
        continue;
      }
    }

    // 2. Check branch filter (if configured)
    if (event.branchName && chat.branchFilter && chat.branchFilter.length > 0) {
      const matchesBranch = chat.branchFilter.some((filter) => {
        if (filter.endsWith('*')) {
          const prefix = filter.slice(0, -1);
          return event.branchName!.startsWith(prefix);
        }
        return event.branchName === filter;
      });

      if (!matchesBranch) {
        continue;
      }
    }

    // 3. Resolve target topic thread ID
    let topicId: number | undefined;
    if (event.eventType !== 'all' && chat.topics[event.eventType] !== undefined && chat.topics[event.eventType] !== null) {
      topicId = chat.topics[event.eventType]!;
    } else if (chat.topics.all !== undefined && chat.topics.all !== null) {
      topicId = chat.topics.all!;
    }

    // 4. Format the message for this chat's verbosity
    const messageHtml = event.format(chat.verbosity);
    if (!messageHtml) {
      continue;
    }

    // 5. Send message to Telegram
    try {
      await bot.api.sendMessage(chat.chatId, messageHtml, {
        parse_mode: 'HTML',
        message_thread_id: topicId,
        disable_notification: chat.silent,
        link_preview_options: {
          is_disabled: false,
        },
      });
      deliveredCount++;
    } catch (err: any) {
      console.error(`Failed to send message to chat ${chat.chatId} (${chat.chatTitle}):`, err.message || err);
      // If thread not found (topic was closed or deleted), fallback to general topic if topicId was set
      if (err.description && err.description.includes('message thread not found') && topicId) {
        try {
          await bot.api.sendMessage(chat.chatId, messageHtml, {
            parse_mode: 'HTML',
            disable_notification: chat.silent,
          });
          deliveredCount++;
        } catch (fallbackErr) {
          console.error(`Fallback send also failed for chat ${chat.chatId}:`, fallbackErr);
        }
      }
    }
  }

  return deliveredCount;
}
