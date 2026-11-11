import type { ChatSettings } from '../types/store.js';

export function validTime(value: string): boolean {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function validTimeZone(value: string): boolean {
  try { new Intl.DateTimeFormat('en-CA', { timeZone: value }); return true; } catch { return false; }
}

function localDateTime(now: Date, timeZone: string): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find(part => part.type === type)!.value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));

export function isQuiet(chat: ChatSettings, now = new Date()): boolean {
  const quiet = chat.quietHours;
  if (!quiet) return false;
  const current = localDateTime(now, quiet.timeZone).minutes;
  const start = minutes(quiet.start), end = minutes(quiet.end);
  return start < end ? current >= start && current < end : current >= start || current < end;
}

export function shouldQueueDigest(chat: ChatSettings, urgent: boolean, now = new Date()): boolean {
  return !urgent && (Boolean(chat.dailyDigest) || isQuiet(chat, now));
}

export function digestDue(chat: ChatSettings, now = new Date()): { due: boolean; date?: string } {
  if (isQuiet(chat, now)) return { due: false };
  if (!chat.dailyDigest) return { due: true };
  const local = localDateTime(now, chat.dailyDigest.timeZone);
  return { due: local.minutes >= minutes(chat.dailyDigest.time) && chat.lastDigestDate !== local.date, date: local.date };
}

export function digestItem(repo: string, html: string): string {
  const plain = html.replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  const compact = plain.replace(/\s+/g, ' ').trim().slice(0, 260);
  const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `• <b>${escape(repo)}</b> — ${escape(compact)}`;
}

export function digestMessages(items: string[]): { text: string; count: number }[] {
  const messages: { text: string; count: number }[] = [];
  let current = '<b>📬 GitHub activity digest</b>\n\n';
  let count = 0;
  for (const item of items) {
    if (current.length + item.length + 2 > 3500) {
      messages.push({ text: current.trim(), count });
      current = '<b>📬 GitHub activity digest (continued)</b>\n\n';
      count = 0;
    }
    current += `${item}\n\n`;
    count++;
  }
  if (items.length) messages.push({ text: current.trim(), count });
  return messages;
}
