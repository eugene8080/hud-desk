import { api, type ChatConversation, type ChatItem } from './api';
import { t } from './i18n';
import { mailDate, mailFilterColumn, type ReaderContent, type ReaderSource } from './mail';
import type { SessionColumns } from './session-list';

export const CHAT_NETWORKS_KEY = 'chat-networks';
const line = (value: string) => value.replace(/\s+/g, ' ').trim();
const chatTitle = (chat: ChatItem) => line(chat.title) || t('chatUntitled');

export function chatColumns(chat: ChatItem): SessionColumns {
  return { marker: chat.unread ? '/' : '-', title: chatTitle(chat),
    right: chat.date ? mailDate(chat.date) : '', preserveSuffix: false };
}

export function chatReaderText(conversation: ChatConversation): ReaderContent {
  const messages = [...conversation.messages].sort((a, b) => a.date - b.date).map(message => {
    const who = message.own ? '/' : `> ${line(message.from) || t('chatSender')}:`;
    return `${who} ${message.text.replace(/\r\n?|\n/g, '\n  ')}`;
  });
  // No blank row between messages (Eugene, 2026-11-27): the '/ ' and '> Sender:' prefixes
  // already mark where each one starts.
  const earlier = messages.slice(0, -1).join('\n');
  return { text: messages.join('\n') || t('chatEmpty'), openingOffset: earlier ? earlier.length + 1 : 0 };
}

export class Chat {
  private selected: Set<string> | null = null;
  constructor(stored: string) {
    try {
      const parsed: unknown = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.every(name => typeof name === 'string')) this.selected = new Set(parsed);
    } catch { /* Default to all networks. */ }
  }

  networks() { return api.chat.networks(); }
  isSelected(name: string) { return this.selected?.has(name) ?? true; }
  isAll() { return this.selected === null; }

  toggle(name: string | null, networks: string[]) {
    if (name === null) this.selected = null;
    else {
      const chosen = this.selected ?? new Set(networks);
      if (!chosen.delete(name)) chosen.add(name);
      this.selected = networks.every(network => chosen.has(network)) ? null : chosen;
    }
    return JSON.stringify(this.selected === null ? null : [...this.selected]);
  }

  async list(page: number) {
    const picks = this.selected ? [...this.selected].sort() : [];
    const result = this.selected?.size === 0 ? { items: [], hasMore: false, unread: 0 } : await api.chat.list(picks, page);
    const extra = Math.max(0, picks.length - 1);
    const summary = picks.length ? `${line(picks[0])}${extra ? ` +${extra}` : ''}` : t(this.isAll() ? 'chatAllNetworks' : 'mailNoLabels');
    return { ...result, filterColumn: mailFilterColumn(summary, extra) };
  }

  reader(chat: ChatItem, statusText: () => string, hold?: () => void): ReaderSource {
    return { title: chatTitle(chat), load: async () => chatReaderText(await api.chat.messages(chat.id)),
      refreshOnEnd: true, statusText, hold };
  }
}
