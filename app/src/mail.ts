import { api, type MailAccount, type MailConversation, type MailLabel, type MailThread } from './api';
import { getLang, t } from './i18n';
import { glassWidth, MENU_RIGHT, menuTitle, type SessionColumns } from './session-list';

export type ReaderContent = { text: string; openingOffset?: number };
export type ReaderSource<Content extends ReaderContent = ReaderContent> = {
  title: string;
  load: () => Promise<Content>;
  statusText?: () => string;
  hold?: () => void;
  refreshOnEnd?: boolean;
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
// A row is a heading (not selectable) or a label toggle (key).
export type LabelPickerRow = { text: string; key?: string; heading?: true };

// The mailbox address names an account on the glasses and the phone; an older bridge
// sends only the short letter.
export const accountName = (account: MailAccount) => singleLine(account.address || account.short);
const accountOf = (key: string) => key.slice(0, key.indexOf(':'));

// One mailbox at a time (Eugene, 2026-11-27: "toggle between the two emails, not to filter and
// see one or both at once"): every account but the one on screen is in `off`. `known` lists the
// accounts already seen; one seen for the first time starts with its Inbox picked, so switching to
// a newly added mailbox shows its Inbox without a visit to the label picker.
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
  // Only the mailbox on screen: its address as a heading, then its labels.
  for (const { account, labels } of accounts) {
    if (off.has(account.id)) continue;
    const visible = search ? labels.filter(label => matchesMailLabel(label.name, search)) : labels;
    if (search && !visible.length) continue;
    flat.push({ text: accountName(account), heading: true });
    if (!account.ok) flat.push({ text: t('mailUnavailable'), heading: true });
    for (const label of visible) {
      const key = `${account.id}:${label.id}`;
      flat.push({ key, text: `[${selected.has(key) ? 'x' : ' '}] ${singleLine(label.name)} (${label.unread})` });
    }
  }
  const known = new Set(flat.map(row => row.key));
  // Picks of the other mailbox are kept for when it is switched back, not "unavailable".
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
      const opensGroup = (row?: LabelPickerRow) => !!row?.heading;
      if (opensGroup(flat[i + take - 1]) && !flat[i + take - 2]?.heading) take--;
    }
    pages.push([...first,
      ...flat.slice(i, i + take), ...(i + take < flat.length ? [{ text: t('moreBelow'), heading: true as const }] : [])]);
    i += take;
  }
  return pages;
}

export function mailColumns(thread: MailThread): SessionColumns {
  const date = mailDate(thread.date);
  // Gutter marks (Eugene, 2026-11-26): '/' unread, as Coding's '/' marks a session waiting for
  // you; '-' read (2026-11-27, was '--'). '*' stays for action rows such as Filter.
  return { marker: thread.unread ? '/' : '-', title: `${singleLine(thread.from)} - ${singleLine(thread.subject)}`,
    right: date, preserveSuffix: false };
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
  private addresses = new Map<string, string>();
  private accountIds: string[] = [];
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
    const adopted = adoptNewAccounts(catalog.map(({ account }) => account), this.selected, this.prefs);
    this.accountIds = catalog.map(({ account }) => account.id);
    const narrowed = this.keepOneMailbox();
    if (adopted) this.save(MAIL_LABELS_KEY, JSON.stringify([...this.selected]));
    if (adopted || narrowed) this.save(MAIL_ACCOUNTS_KEY, this.accountsJson());
    for (const { account, labels } of catalog) {
      this.addresses.set(account.id, accountName(account));
      for (const label of labels) this.names.set(`${account.id}:${label.id}`, singleLine(label.name));
    }
    return catalog;
  }

  selectedLabels(): ReadonlySet<string> { return this.selected ?? new Set(); }

  // Exactly one mailbox on when there are two or more: the first one already on, else the first.
  // Returns true when `off` changed (a saved two-mailbox filter from 1.0.62-1.0.66 narrows here).
  private keepOneMailbox(): boolean {
    const ids = this.accountIds;
    if (ids.length < 2) return false;
    const on = ids.filter(id => !this.prefs.off.has(id));
    if (on.length === 1) return false;
    const keep = on[0] ?? ids[0];
    this.prefs.off = new Set(ids.filter(id => id !== keep));
    return true;
  }

  // The mailbox on screen (undefined before the first catalog read) and its address.
  currentMailbox(): string | undefined { return this.accountIds.find(id => !this.prefs.off.has(id)); }
  mailboxName(): string {
    const id = this.currentMailbox();
    return this.accountIds.length > 1 && id ? this.addresses.get(id) ?? id : '';
  }
  mailboxes(): { id: string; name: string }[] {
    return this.accountIds.map(id => ({ id, name: this.addresses.get(id) ?? id }));
  }
  // The next mailbox in configuration order, wrapping; the row under row 0 toggles with it.
  nextMailbox(): string | undefined {
    const ids = this.accountIds;
    if (ids.length < 2) return undefined;
    return ids[(ids.indexOf(this.currentMailbox() ?? ids[0]) + 1) % ids.length];
  }
  selectMailbox(id: string): string {
    if (this.accountIds.includes(id)) this.prefs.off = new Set(this.accountIds.filter(other => other !== id));
    return this.accountsJson();
  }

  async list(page: number) {
    await this.labelGroups();
    // Two mailboxes: the mailbox row and Filter by Label leave seven thread rows, as Coding's two
    // filter rows leave seven sessions. One mailbox: Filter by Label and eight threads.
    const mailbox = this.mailboxName();
    const size = mailbox ? 7 : 8;
    const picks = effectiveLabels(this.selected!, this.prefs.off);
    const result = picks.length ? await api.mail.threads(picks, page, size) : { items: [], hasMore: false, unread: 0, loading: false };
    return { ...result, size, mailbox, items: [...result.items].sort((a, b) => b.date - a.date),
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
