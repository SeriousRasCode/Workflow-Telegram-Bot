import { bot } from '../bot/instance.js';
import { store } from '../storage/store.js';
import { DispatchedEvent } from './dispatcher.js';
import { selectWorkflowAlert, recordWorkflowAlert } from './workflow_alerts.js';
import { digestDue, digestItem, digestMessages, shouldQueueDigest } from '../bot/digest.js';
import { effectiveSettings } from '../bot/repository_rules.js';

export async function broadcastGitHubEvent(event: DispatchedEvent, deliveryId?: string): Promise<number> {
  const targetChats = store.getChatsForRepo(event.repoFullName);
  if (targetChats.length === 0) {
    console.log(`ℹ️ No chats subscribed to repository "${event.repoFullName}" (total known chats: ${store.getAllChats().length})`);
    return 0;
  }

  let deliveredCount = 0;

  for (const targetChat of targetChats) {
    const chat = effectiveSettings(targetChat, event.repoFullName);
    if (deliveryId && store.wasDelivered(deliveryId, chat.chatId)) continue;
    const status = (state: 'delivered' | 'digest' | 'filtered' | 'disabled' | 'failed', detail?: string) => {
      if (deliveryId) store.recordDeliveryStatus(chat.chatId, { deliveryId, repo: event.repoFullName,
        eventType: event.eventType, state, detail });
    };
    // 1. Check if event is enabled for this chat
    if (event.eventType !== 'all') {
      const isEnabled = chat.eventsEnabled[event.eventType];
      if (!isEnabled) {
        status('disabled');
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
        status('filtered', 'Branch filter');
        continue;
      }
    }

    // 3. Resolve target topic thread ID
    let topicId: number | undefined;
    if (chat.topics[event.eventType] === null) {
      topicId = undefined;
    } else if (event.eventType !== 'all' && chat.topics[event.eventType] !== undefined) {
      topicId = chat.topics[event.eventType]!;
    } else if (chat.topics.all !== undefined && chat.topics.all !== null) {
      topicId = chat.topics.all!;
    }

    // 4. Format the message for this chat's verbosity
    const alert = selectWorkflowAlert(event, chat);
    if (!alert) {
      status('filtered', 'Event action or alert mode');
      continue;
    }
    const messageHtml = alert.message;
    if (shouldQueueDigest(chat, Boolean(alert.failureKey || alert.clearKey))) {
      store.queueDigest(chat.chatId, digestItem(event.repoFullName, messageHtml));
      if (deliveryId) store.recordDelivery(deliveryId, chat.chatId);
      status('digest');
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
      if (deliveryId) store.recordDelivery(deliveryId, chat.chatId);
      status('delivered');
      if (alert.failureKey || alert.clearKey) {
        recordWorkflowAlert(chat, alert);
        store.updateChat(chat.chatId, { workflowFailures: chat.workflowFailures });
      }
    } catch (err: any) {
      status('failed', 'Telegram send failed');
      console.error(`Failed to send message to chat ${chat.chatId} (${chat.chatTitle}):`, err.message || err);
      // If thread not found (topic was closed or deleted), fallback to general topic if topicId was set
      if (err.description && err.description.includes('message thread not found') && topicId) {
        try {
          await bot.api.sendMessage(chat.chatId, messageHtml, {
            parse_mode: 'HTML',
            disable_notification: chat.silent,
          });
          deliveredCount++;
          if (deliveryId) store.recordDelivery(deliveryId, chat.chatId);
          status('delivered', 'Sent to general chat after topic failure');
          if (alert.failureKey || alert.clearKey) {
            recordWorkflowAlert(chat, alert);
            store.updateChat(chat.chatId, { workflowFailures: chat.workflowFailures });
          }
        } catch (fallbackErr) {
          console.error(`Fallback send also failed for chat ${chat.chatId}:`, fallbackErr);
        }
      }
    }
  }

  return deliveredCount;
}

let digestRunning = false;
export async function flushDigests(): Promise<void> {
  if (digestRunning) return;
  digestRunning = true;
  try {
    for (const chat of store.getAllChats()) {
      const due = digestDue(chat);
      if (!due.due) continue;
      const items = store.getDigestItems(chat.chatId);
      if (!items.length) {
        if (due.date) store.updateChat(chat.chatId, { lastDigestDate: due.date });
        continue;
      }
      const messages = digestMessages(items);
      let sent = 0;
      for (const message of messages) {
        try {
          await bot.api.sendMessage(chat.chatId, message.text, { parse_mode: 'HTML', disable_notification: chat.silent,
            message_thread_id: chat.topics.all ?? undefined });
          store.removeDigestItems(chat.chatId, message.count);
          sent++;
        } catch (err) {
          console.error(`Digest delivery failed for chat ${chat.chatId}:`, err);
          break;
        }
      }
      if (sent === messages.length) {
        if (due.date) store.updateChat(chat.chatId, { lastDigestDate: due.date });
      }
    }
  } finally { digestRunning = false; }
}
