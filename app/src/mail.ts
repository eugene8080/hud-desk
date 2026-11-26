import { api, type MailAccount, type MailConversation, type MailLabel, type MailThread } from './api';
import { getLang, t } from './i18n';
import { glassWidth, MENU_RIGHT, menuTitle, type SessionColumns } from './session-list';

export type ReaderContent = { text: string; openingOffset?: number };
export type ReaderSource<Content extends ReaderContent = ReaderContent> = {
  title: string;
  load: () => Promise<Content>;
  statusText?: () => string;
  hold?: () => void;
  afterDisplay?: () => Promise<void>;
};

export function mailDate(timestamp: number, now = new Date()): string {
  const date = new Date(timestamp);
  if (date.toDateString() === now.toDateString()) {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }
  return `${date.getDate()} ${new Intl.DateTimeFormat('en-GB', { month: 'short' }).format(date)}`;
}

export function mailFilterSummary(selected: Set<string>, names: Map<string, string>): string {
  const first = selected.values().next().value;
  if (first === undefined) return t('mailNoLabels');
  const extra = selected.size - 1;
  return `${names.get(first) ?? (first.endsWith(':INBOX') ? 'Inbox' : t('unavailableSection'))}${extra ? ` +${extra}` : ''}`;
}

export function mailReaderText(conversation: MailConversation): ReaderContent {
  const subject = singleLine(conversation.subject);
  const messages = [...conversation.messages].sort((a, b) => a.date - b.date).map(message => [
    t('mailFrom', singleLine(message.from)),
    t('mailDate', new Date(message.date).toLocaleString(getLang())),
    t('mailSubject', subject),
    '',
    message.text,
  ].join('\n'));
  const before = messages.slice(0, -1).join('\n\n');
  return { text: messages.join('\n\n'), openingOffset: before ? before.length + 2 : 0 };
}

function singleLine(text: string): string { return text.replace(/\s+/g, ' ').trim(); }

type AccountLabels = { account: MailAccount; labels: MailLabel[] };
export type LabelPickerRow = { text: string; key?: string; heading?: true };

export function labelPickerPages(accounts: AccountLabels[], selected: Set<string>): LabelPickerRow[][] {
  const flat: LabelPickerRow[] = [];
  for (const { account, labels } of accounts) {
    flat.push({ text: singleLine(account.short), heading: true });
    if (!account.ok) flat.push({ text: t('mailUnavailable'), heading: true });
    for (const label of labels) {
      const key = `${account.id}:${label.id}`;
      flat.push({ key, text: `[${selected.has(key) ? 'x' : ' '}] ${singleLine(label.name)} (${label.unread})` });
    }
  }
  const known = new Set(flat.map(row => row.key));
  const missing = [...selected].filter(key => !known.has(key));
  if (missing.length) {
    flat.push({ text: t('unavailableSection'), heading: true });
    for (const key of missing) flat.push({ key, text: `[x] ${singleLine(key)}` });
  }
  const pages: LabelPickerRow[][] = [];
  for (let i = 0; i < flat.length || !pages.length;) {
    const above = pages.length > 0;
    const capacity = above ? 8 : 9; // Done and, on later pages, the upper cue.
    let take = Math.min(flat.length - i, capacity);
    if (i + take < flat.length) {
      take--;
      // Keep the account heading with its first label or availability row.
      if (flat[i + take - 1]?.heading && !flat[i + take - 2]?.heading) take--;
    }
    pages.push([{ text: t('done') }, ...(above ? [{ text: t('moreAbove'), heading: true as const }] : []),
      ...flat.slice(i, i + take), ...(i + take < flat.length ? [{ text: t('moreBelow'), heading: true as const }] : [])]);
    i += take;
  }
  return pages;
}

export function mailColumns(thread: MailThread): SessionColumns {
  return { marker: thread.unread ? '*' : '', title: `${singleLine(thread.from)} - ${singleLine(thread.subject)}`, right: mailDate(thread.date), preserveSuffix: false };
}

export function mailFilterColumn(summary: string, extra: number): string {
  const suffix = extra ? ` +${extra}` : '';
  const label = suffix ? summary.slice(0, -suffix.length) : summary;
  return `[${menuTitle(label, MENU_RIGHT.width - 6 - glassWidth(`[]${suffix}`), false)}${suffix}]`;
}

export class Mail {
  private selected: Set<string> | null;
  private catalog?: Promise<AccountLabels[]>;
  private names = new Map<string, string>();
  private marking = new Map<string, Promise<void>>();

  constructor(stored: string) {
    this.selected = null;
    try {
      const labels: unknown = JSON.parse(stored);
      if (Array.isArray(labels) && labels.every((label): label is string => typeof label === 'string')) this.selected = new Set(labels);
    } catch { /* A missing or invalid preference uses Inbox. */ }
  }

  private async loadCatalog(refresh = false) {
    if (refresh || !this.catalog) {
      const request = api.mail.accounts().then(accounts => Promise.all(accounts.map(async account => {
        if (!account.ok) return { account, labels: [] };
        try { return { account, labels: await api.mail.labels(account.id) }; }
        catch { return { account: { ...account, ok: false }, labels: [] }; }
      })));
      this.catalog = request;
      void request.catch(() => { if (this.catalog === request) this.catalog = undefined; });
    }
    const catalog = await this.catalog;
    this.selected ??= new Set(catalog.map(({ account }) => `${account.id}:INBOX`));
    for (const { account, labels } of catalog) {
      for (const label of labels) this.names.set(`${account.id}:${label.id}`, singleLine(label.name));
    }
    return catalog;
  }

  async list(page: number) {
    await this.loadCatalog();
    const selected = this.selected!;
    const result = selected.size ? await api.mail.threads([...selected], page) : { items: [], hasMore: false, unread: 0 };
    return { ...result, items: [...result.items].sort((a, b) => b.date - a.date), filterColumn: mailFilterColumn(mailFilterSummary(selected, this.names), Math.max(0, selected.size - 1)) };
  }

  async picker(refresh = false) {
    return labelPickerPages(await this.loadCatalog(refresh), this.selected!);
  }

  toggle(key: string): string {
    const selected = this.selected!;
    if (!selected.delete(key)) selected.add(key);
    return JSON.stringify([...selected]);
  }

  reader(thread: MailThread): ReaderSource {
    let failed = false;
    let displayed = false;
    return {
      title: singleLine(thread.subject),
      load: async () => mailReaderText(await api.mail.thread(thread.account, thread.id)),
      statusText: () => failed ? t('mailNotMarkedRead') : ' ',
      afterDisplay: async () => {
        if (displayed || !thread.unread) return;
        displayed = true;
        const key = `${thread.account}:${thread.id}`;
        let request = this.marking.get(key);
        if (!request) {
          request = api.mail.read(thread.account, thread.id).then(result => {
            if (!result.ok) throw new Error('Mark read failed');
          }).finally(() => this.marking.delete(key));
          this.marking.set(key, request);
        }
        try { await request; thread.unread = false; }
        catch { failed = true; }
      },
    };
  }
}
