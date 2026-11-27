import { api, type ChatConversation, type ChatItem, type ChatTranslation } from './api';
import { t } from './i18n';
import { mailDate, mailFilterColumn, type ReaderContent, type ReaderSource } from './mail';
import type { SessionColumns } from './session-list';

export const CHAT_NETWORKS_KEY = 'chat-networks';
export const CHAT_TRANSLATE_KEY = 'chat-translate';
const line = (value: string) => value.replace(/\s+/g, ' ').trim();
const chatTitle = (chat: ChatItem) => line(chat.title) || t('chatUntitled');
const withEnglish = (original: string, english?: string | null) => english ? `${original} (${line(english)})` : original;
type VoiceStatus = 'chatTranscribing' | 'chatNotTranscribed';
type ChatContent = ReaderContent & { voiceLines: { id: string; line: number }[] };

function durationTag(duration?: number) {
  if (duration === undefined || !Number.isFinite(duration) || duration < 0) return '';
  const seconds = Math.floor(duration);
  return ` ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function chatColumns(chat: ChatItem): SessionColumns {
  return { marker: chat.unread ? '/' : '-', title: chatTitle(chat),
    right: chat.date ? mailDate(chat.date) : '', preserveSuffix: false };
}

export function chatReaderText(conversation: ChatConversation, statuses = new Map<string, VoiceStatus>(),
  translations = new Map<string, ChatTranslation>()): ChatContent {
  let lineIndex = 0;
  const voiceLines: ChatContent['voiceLines'] = [];
  const messages = [...conversation.messages].sort((a, b) => a.date - b.date).map(message => {
    const who = message.own ? '/' : `> ${line(message.from) || t('chatSender')}:`;
    const voice = message.voice;
    const id = voice?.id;
    if (id && !voice.transcript) voiceLines.push({ id, line: lineIndex });
    const status = id && statuses.get(id);
    const duration = durationTag(voice?.duration);
    const tag = message.media ? `[${message.media}${duration}${status && !voice?.transcript ? ` · ${t(status)}` : ''}]` : '';
    const translated = translations.get(message.id ?? id ?? '');
    const caption = withEnglish(message.text, translated?.text);
    const transcript = voice?.transcript ? withEnglish(voice.transcript, translated?.voice) : '';
    const text = `${who} ${[tag, caption, transcript].filter(Boolean).join(' ').replace(/\r\n?|\n/g, '\n  ')}`;
    lineIndex += text.split('\n').length;
    return text;
  });
  // No blank row between messages (Eugene, 2026-11-27): the '/ ' and '> Sender:' prefixes
  // already mark where each one starts.
  const earlier = messages.slice(0, -1).join('\n');
  return { text: messages.join('\n') || t('chatEmpty'), openingOffset: earlier ? earlier.length + 1 : 0, voiceLines };
}

export class ChatReader implements ReaderSource<ChatContent> {
  readonly title: string;
  readonly refreshOnEnd = true;
  private conversation: ChatConversation = { messages: [] };
  private statuses = new Map<string, VoiceStatus>();
  private translations = new Map<string, ChatTranslation>();

  constructor(private chat: ChatItem, private translateEnabled: () => boolean,
    readonly statusText: () => string, readonly hold?: () => void) {
    this.title = chatTitle(chat);
  }

  content() {
    return chatReaderText(this.conversation, this.statuses, this.translateEnabled() ? this.translations : undefined);
  }

  async load() {
    const incoming = await api.chat.messages(this.chat.id);
    const previous = new Map(this.conversation.messages.map(message => [message.id, message]));
    const translations = new Map<string, ChatTranslation>();
    this.conversation = {
      messages: incoming.messages.map(message => {
        const id = message.id;
        const before = previous.get(id);
        const voice = message.voice && !message.voice.transcript && before?.voice?.transcript ? before.voice : message.voice;
        if (id) {
          const cached = this.translations.get(id);
          if (cached) translations.set(id, { id,
            text: before?.text === message.text ? cached.text : undefined,
            voice: before?.voice?.transcript === voice?.transcript ? cached.voice : undefined,
          });
        }
        return { ...message, voice: voice && { ...voice } };
      }),
    };
    this.translations = translations;
    return this.content();
  }

  async translate(ids?: string[]) {
    const conversation = this.conversation;
    ids ??= conversation.messages.flatMap(message => message.id ? [message.id] : []);
    if (!this.translateEnabled() || !ids.length) return false;
    try {
      const { items } = await api.chat.translate(this.chat.id, ids);
      if (this.conversation !== conversation) return false;
      for (const item of items) this.translations.set(item.id, { ...this.translations.get(item.id), ...item });
      return this.translateEnabled();
    } catch { return false; } // Continue showing the original if the local engine is unavailable.
  }

  async transcribe(ids: string[], repaint: () => Promise<void>) {
    const pending = ids.filter(id => this.statuses.get(id) !== 'chatTranscribing');
    if (!pending.length) return;
    pending.forEach(id => this.statuses.set(id, 'chatTranscribing'));
    await repaint();
    const completed = [];
    for (const id of pending) {
      try {
        const { text, language } = await api.chat.transcribe(this.chat.id, id);
        if (!text) throw new Error('Missing transcript');
        const voice = this.conversation.messages.find(message => message.voice?.id === id)?.voice;
        if (voice) Object.assign(voice, { transcript: text, language });
        this.statuses.delete(id);
        completed.push(id);
      } catch { this.statuses.set(id, 'chatNotTranscribed'); }
      await repaint();
    }
    if (completed.length && await this.translate(completed)) await repaint();
  }
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
}
