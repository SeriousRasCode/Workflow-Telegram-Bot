import type { ChatSettings } from '../types/store.js';
import type { DispatchedEvent } from './dispatcher.js';
import { escapeHtml } from '../bot/utils.js';

export type WorkflowAlert = { message: string; failureKey?: string; clearKey?: string };

export function selectWorkflowAlert(event: DispatchedEvent, chat: ChatSettings): WorkflowAlert | null {
  const workflow = event.workflow;
  if (!workflow || (chat.workflowAlerts || 'all') === 'all') {
    const message = event.format(chat.verbosity);
    if (!message) return null;
    if (workflow?.conclusion === 'failure' || workflow?.conclusion === 'timed_out') {
      return { message, failureKey: workflow.key };
    }
    if (workflow?.conclusion === 'success' && chat.workflowFailures?.[workflow.key]) {
      return { message, clearKey: workflow.key };
    }
    return { message };
  }

  if (workflow.conclusion === 'failure' || workflow.conclusion === 'timed_out') {
    const message = event.format(chat.verbosity);
    return message ? { message, failureKey: workflow.key } : null;
  }
  if (workflow.conclusion === 'success' && chat.workflowFailures?.[workflow.key]) {
    return {
      message: `✅ <b>${escapeHtml(event.repoFullName)}</b>\n<b>Workflow recovered:</b> <a href="${escapeHtml(workflow.url)}">${escapeHtml(workflow.name)}</a>${event.branchName ? ` on <code>${escapeHtml(event.branchName)}</code>` : ''}`,
      clearKey: workflow.key,
    };
  }
  return null;
}

export function recordWorkflowAlert(chat: ChatSettings, alert: WorkflowAlert): void {
  if (alert.failureKey) (chat.workflowFailures ||= {})[alert.failureKey] = true;
  if (alert.clearKey) delete chat.workflowFailures?.[alert.clearKey];
}
