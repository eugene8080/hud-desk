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

export type AccountLabels = { account: MailAccount; labels: MailLabel[] };
// A row is a heading (not selectable), a label toggle (key) or an account toggle (account).
export type LabelPickerRow = { text: string; key?: string; account?: string; heading?: true };

// The mailbox address names an account on the glasses and the phone; an older bridge
// sends only the short letter.
export const accountName = (account: MailAccount) => singleLine(account.address || account.short);
const accountOf = (key: string) => key.slice(0, key.indexOf(':'));

// Filter by email address: the accounts switched off, and the accounts already seen.
// An account seen for the first time starts with its Inbox picked, so a newly added
// mailbox shows up without a visit to the label picker.
export type AccountPrefs = { off: Set<string>; known: Set<string> | null };
export function parseAccountPrefs(stored: string): AccountPrefs {
  try {
    const value: unknown = JSON.parse(stored);
    if (value && typeof value === 'object') {
      const { off, known } = value as { off?: unknown; known?: unknown };
      const strings = (list: unknown) => Array.isArray(list) && list.every(item => typeof item === 'string') ? list as string[] : null;
      const knownList = strings(known);
      return { off: new Set(strings(off) ?? []), known: knownList ? new Set(knownList) : null };
    }
  } catch { /* A missing or invalid preference shows every account. */ }
  return { off: new Set(), known: null };
}

// Adds Inbox for each account not seen before; returns true when the picks changed.
// Before this preference existed, an account that already has a picked label counts as seen,
// so the first run after an update keeps the labels the user chose.
export function adoptNewAccounts(accounts: MailAccount[], selected: Set<string>, prefs: AccountPrefs): boolean {
  const known = prefs.known ?? new Set([...selected].map(accountOf));
  let changed = prefs.known === null;
  for (const account of accounts) {
    if (known.has(account.id)) continue;
    known.add(account.id);
    selected.add(`${account.id}:INBOX`);
    changed = true;
  }
  prefs.known = known;
  return changed;
}

// The label keys the thread list asks for: picks of the accounts that are switched on.
export const effectiveLabels = (selected: ReadonlySet<string>, off: ReadonlySet<string>) =>
  [...selected].filter(key => !off.has(accountOf(key)));

const numberWords = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven',
  'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
function labelTokens(text: string): string[] {
  return (text.normalize('NFKC').toLowerCase().match(/\p{L}+|\p{N}+/gu) ?? []).map(word => {
    const number = numberWords.indexOf(word);
    return number < 0 ? word : String(number + 1);
  });
}

export function matchesMailLabel(label: string, query: string): boolean {
  const tokens = labelTokens(label);
  const joined = tokens.join(' ');
  // A leading label ordinal does not obstruct a name search, but can still be
  // requested explicitly ("six projects" matches "6. Projects").
  return labelTokens(query).every(word => /^\d+$/.test(word) ? tokens.includes(word) : joined.includes(word));
}

export function labelPickerPages(accounts: AccountLabels[], selected: Set<string>, search = '', off: ReadonlySet<string> = new Set()): LabelPickerRow[][] {
  const flat: LabelPickerRow[] = [];
  // With two or more mailboxes the address row is a checkbox (Filter by email address);
  // with one it stays a heading, because switching the only mailbox off empties the list.
  const toggles = accounts.length > 1;
  for (const { account, labels } of accounts) {
    const on = !off.has(account.id);
    if (search && !on) continue;
    const visible = search ? labels.filter(label => matchesMailLabel(label.name, search)) : labels;
    if (search && !visible.length) continue;
    flat.push(toggles && !search
      ? { text: `[${on ? 'x' : ' '}] ${accountName(account)}`, account: account.id }
      : { text: accountName(account), heading: true });
    if (!on) continue;
    if (!account.ok) flat.push({ text: t('mailUnavailable'), heading: true });
    for (const label of visible) {
      const key = `${account.id}:${label.id}`;
      flat.push({ key, text: `[${selected.has(key) ? 'x' : ' '}] ${singleLine(label.name)} (${label.unread})` });
    }
  }
  const known = new Set(flat.map(row => row.key));
  // Picks of a switched-off mailbox are kept for when it is switched back on, not "unavailable".
  const missing = [...selected].filter(key => !known.has(key) && !off.has(accountOf(key)));
  if (!search && missing.length) {
    flat.push({ text: t('unavailableSection'), heading: true });
    for (const key of missing) flat.push({ key, text: `[x] ${singleLine(key)}` });
  }
  if (search && !flat.length) flat.push({ text: t('mailNoMatches'), heading: true });
  const pages: LabelPickerRow[][] = [];
  for (let i = 0; i < flat.length || !pages.length;) {
    const above = pages.length > 0;
    const first: LabelPickerRow[] = [{ text: t('done') }];
    if (search) first.push({ text: t('mailSearchResult', singleLine(search)), heading: true });
    if (above) first.push({ text: t('moreAbove'), heading: true });
    const capacity = 10 - first.length;
    let take = Math.min(flat.length - i, capacity);
    if (i + take < flat.length) {
      take--;
      // Keep the account heading with its first label or availability row.
      const opensGroup = (row?: LabelPickerRow) => !!(row?.heading || row?.account);
      if (opensGroup(flat[i + take - 1]) && !flat[i + take - 2]?.heading) take--;
    }
    pages.push([...first,
      ...flat.slice(i, i + take), ...(i + take < flat.length ? [{ text: t('moreBelow'), heading: true as const }] : [])]);
    i += take;
  }
  return pages;
}

// With two or more mailboxes on, the right column starts with the account letter: '[W] 14:05'.
export function mailColumns(thread: MailThread, accountLetter = ''): SessionColumns {
  const date = mailDate(thread.date);
  // Gutter marks (Eugene, 2026-11-26): '/' unread, as Coding's '/' marks a session waiting for
  // you; '--' read. '*' stays for action rows such as Filter.
  return { marker: thread.unread ? '/' : '--', title: `${singleLine(thread.from)} - ${singleLine(thread.subject)}`,
    right: accountLetter ? `[${accountLetter}] ${date}` : date, preserveSuffix: false };
}

export function mailFilterColumn(summary: string, extra: number): string {
  const suffix = extra ? ` +${extra}` : '';
  const label = suffix ? summary.slice(0, -suffix.length) : summary;
  return `[${menuTitle(label, MENU_RIGHT.width - 6 - glassWidth(`[]${suffix}`), false)}${suffix}]`;
}

export const MAIL_LABELS_KEY = 'mail-labels';
export const MAIL_ACCOUNTS_KEY = 'mail-accounts';

export class Mail {
  private selected: Set<string> | null;
  private prefs: AccountPrefs;
  private catalog?: Promise<AccountLabels[]>;
  private names = new Map<string, string>();
  private letters = new Map<string, string>();
  private marking = new Map<string, Promise<void>>();

  // save persists a preference the class changes by itself (a new account's Inbox).
  constructor(stored: string, storedAccounts = '', private save: (key: string, value: string) => void = () => {}) {
    this.selected = null;
    try {
      const labels: unknown = JSON.parse(stored);
      if (Array.isArray(labels) && labels.every((label): label is string => typeof label === 'string')) this.selected = new Set(labels);
    } catch { /* A missing or invalid preference uses Inbox. */ }
    this.prefs = parseAccountPrefs(storedAccounts);
  }

  private accountsJson() { return JSON.stringify({ off: [...this.prefs.off], known: [...(this.prefs.known ?? [])] }); }

  async labelGroups(refresh = false) {
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
    if (adoptNewAccounts(catalog.map(({ account }) => account), this.selected, this.prefs)) {
      this.save(MAIL_LABELS_KEY, JSON.stringify([...this.selected]));
      this.save(MAIL_ACCOUNTS_KEY, this.accountsJson());
    }
    for (const { account, labels } of catalog) {
      this.letters.set(account.id, singleLine(account.short));
      for (const label of labels) this.names.set(`${account.id}:${label.id}`, singleLine(label.name));
    }
    return catalog;
  }

  selectedLabels(): ReadonlySet<string> { return this.selected ?? new Set(); }
  accountsOff(): ReadonlySet<string> { return this.prefs.off; }

  async list(page: number) {
    const catalog = await this.labelGroups();
    const picks = effectiveLabels(this.selected!, this.prefs.off);
    const result = picks.length ? await api.mail.threads(picks, page) : { items: [], hasMore: false, unread: 0 };
    const shown = catalog.filter(({ account }) => !this.prefs.off.has(account.id)).length;
    return { ...result, items: [...result.items].sort((a, b) => b.date - a.date),
      // The letter tells two mailboxes apart; one mailbox needs no letter.
      letter: (thread: MailThread) => shown > 1 ? this.letters.get(thread.account) ?? '' : '',
      filterColumn: mailFilterColumn(mailFilterSummary(new Set(picks), this.names), Math.max(0, picks.length - 1)) };
  }

  async picker(refresh = false, search = '') {
    return labelPickerPages(await this.labelGroups(refresh), this.selected!, search, this.prefs.off);
  }

  toggle(key: string): string {
    const selected = this.selected!;
    if (!selected.delete(key)) selected.add(key);
    return JSON.stringify([...selected]);
  }

  // Filter by email address: switch one mailbox's threads and labels off or on.
  toggleAccount(id: string): string {
    if (!this.prefs.off.delete(id)) this.prefs.off.add(id);
    return this.accountsJson();
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
