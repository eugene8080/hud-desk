import { createHash, randomUUID } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, sep } from 'node:path';
import { MailError } from './gmail.mjs';
import { outgoing, readDraft, replyFields } from './mail-compose.mjs';
import { bodyHtml, bodyText, htmlImages, parseFrom } from './mail-text.mjs';

const UID = { uid: true };
const SEARCH_UIDS = { ...UID, strict: true };
const MOVES = new Set(['archive', 'unarchive', 'trash', 'untrash']);
const FLAGS = new Map([
  ['read', ['messageFlagsAdd', '\\Seen']], ['unread', ['messageFlagsRemove', '\\Seen']],
  ['star', ['messageFlagsAdd', '\\Flagged']], ['unstar', ['messageFlagsRemove', '\\Flagged']],
]);
const HIDDEN = new Set(['\\Junk', '\\Spam', '\\Trash', '\\Drafts']);
const VIRTUAL = new Set(['\\All', '\\Flagged']);
const MAX_SOURCE = 25 * 1024 * 1024;
const UNDO_MS = 10 * 60_000;
const missing = () => new MailError('not found', 404);
const badRequest = () => new MailError('bad request', 400);
const network = () => new MailError('network', 502);
const hash = value => createHash('sha256').update(value).digest('base64url');
const labelId = path => /^inbox$/i.test(path) ? 'INBOX' : `f_${hash(path)}`;
const imapIds = value => String(value ?? '').match(/<[^<>\s]+>/g) ?? [];
const mailboxPath = (folders, role) => folders.find(folder => folder.specialUse === role)?.path;
const dateOf = item => +new Date(item.internalDate ?? 0) || +new Date(item.envelope?.date ?? 0) || 0;

async function passwordFile(account) {
  try {
    const path = await realpath(account.secretFile);
    const within = relative(account.local, path);
    if (!within || within === '..' || within.startsWith('..' + sep) || isAbsolute(within)) throw new Error();
    const password = (await readFile(path, 'utf8')).replace(/\r?\n$/, '');
    if (!password.trim() || /[\x00-\x1f\x7f]/.test(password) || password.length > 4096) throw new Error();
    return password;
  } catch {
    throw new MailError('auth', 502);
  }
}

const newImap = async options => new (await import('imapflow')).ImapFlow(options);
const newSmtp = async options => (await import('nodemailer')).default.createTransport(options);
const parseMime = async source => (await import('mailparser')).simpleParser(source, {
  keepCidLinks: true, skipHtmlToText: true, skipTextToHtml: true,
});

function tlsOptions({ host, port, tls, username }, address, pass) {
  return { host, port, secure: tls === 'implicit', auth: { user: username ?? address, pass }, logger: false,
    tls: { rejectUnauthorized: true } };
}

async function selected(client, path, task, readOnly = true, validity) {
  const lock = await client.getMailboxLock(path, { readOnly });
  try {
    if (validity !== undefined && client.mailbox.uidValidity !== validity) throw missing();
    return await task(client.mailbox.uidValidity);
  } finally {
    lock.release();
  }
}

const addressText = boxes => [boxes].flat().filter(Boolean).flatMap(group => group.value ?? [])
  .flatMap(entry => entry.group ?? [entry])
  .filter(entry => entry.address)
  .map(({ address, name }) => name ? `"${name.replace(/["\\]/g, '\\$&')}" <${address}>` : address)
  .filter(Boolean).join(', ');
const part = (mimeType, content, extra) => ({ mimeType, ...extra, body: {
  size: Buffer.byteLength(content), data: Buffer.from(content).toString('base64url'),
} });

// Project MIME into the shared text/picture representation so cid paths and newsletter images
// use the same placement, filtering and rendering as Gmail API messages.
async function content(client, item, parse) {
  const source = await selected(client, item.path, async () => {
    const result = await client.fetchOne(item.uid, { source: { start: 0, maxLength: MAX_SOURCE + 1 } }, UID);
    if (!result?.source) throw missing();
    if (result.source.length > MAX_SOURCE) throw new MailError('message-too-large', 413);
    return result.source;
  }, true, item.validity);
  const mail = await parse(source);
  const from = addressText(mail.from), to = addressText(mail.to), cc = addressText(mail.cc);
  const payload = { parts: [
    ...(mail.text ? [part('text/plain', mail.text)] : []),
    ...(mail.html ? [part('text/html', mail.html)] : []),
    ...mail.attachments.filter(file => file.contentType?.startsWith('image/')).slice(0, 20).map((file, i) =>
      part(file.contentType, file.content, {
        partId: String(i + 1), filename: file.filename, headers: [{ name: 'Content-ID', value: file.contentId }],
      })),
  ] };
  return { from, to, cc, payload, subject: mail.subject ?? '', replyTo: addressText(mail.replyTo),
    date: mail.date?.toUTCString() ?? '', timestamp: item.date, messageId: mail.messageId ?? '',
    references: [mail.references ?? ''].flat().join(' '), attachments: mail.attachments.length };
}

function identify(item, gmail) {
  if (gmail) return { message: `gm_${item.emailId}`, thread: `gt_${item.threadId}` };
  const self = imapIds(item.envelope?.messageId)[0];
  const refs = [...new Set([
    ...imapIds(item.headers?.toString().replace(/\r?\n[ \t]+/g, ' ')),
    ...imapIds(item.envelope?.inReplyTo),
  ])].filter(ref => ref !== self);
  // A UID identifies a physical copy only within its mailbox and UIDVALIDITY epoch.
  const key = self ?? JSON.stringify([item.path, String(item.validity), item.uid]);
  return { message: `m_${hash(key)}`, key, refs };
}

// Link entire References chains, even when an ancestor is absent from the server.
// Prefer an unreferenced ancestor as the thread key, without grouping unrelated same subjects.
function threadGeneric(items) {
  const parents = new Map();
  const hasParent = new Set();
  function root(key) {
    let parent = key;
    while (parents.has(parent)) parent = parents.get(parent);
    while (parents.has(key) && parents.get(key) !== parent) {
      const next = parents.get(key);
      parents.set(key, parent);
      key = next;
    }
    return parent;
  }
  for (const { key, refs } of items) {
    for (let i = 0; i < refs.length; i++) {
      const child = refs[i + 1] ?? key;
      const a = root(refs[i]), b = root(child);
      hasParent.add(child);
      if (a !== b) parents.set(b, a);
    }
  }
  const anchors = new Map();
  for (const key of new Set(items.flatMap(item => [item.key, ...item.refs]))) {
    const group = root(key), previous = anchors.get(group);
    if (previous === undefined || Number(hasParent.has(previous)) > Number(hasParent.has(key)) ||
        (hasParent.has(previous) === hasParent.has(key) && key < previous)) anchors.set(group, key);
  }
  for (const item of items) item.thread = `t_${hash(anchors.get(root(item.key)))}`;
}

function flags(item, flag) {
  return item.flags?.has(flag) ?? false;
}

async function searchUids(client, criteria) {
  const uids = await client.search({ ...criteria, deleted: false }, SEARCH_UIDS);
  if (!Array.isArray(uids)) throw network();
  return uids;
}

const META = { envelope: true, flags: true, internalDate: true, headers: ['References'] };
const GOOGLE = { ...META, headers: undefined, threadId: true, labels: true };
async function readFolder(client, path, gmail, search) {
  return selected(client, path, async validity => {
    const uids = await searchUids(client, search);
    const items = [];
    for (let offset = 0; offset < uids.length; offset += 500) {
      for (const wire of await client.fetchAll(uids.slice(offset, offset + 500), gmail ? GOOGLE : META, UID)) {
        const item = { ...wire, path, validity, date: dateOf(wire) };
        if (!gmail || (/^\d+$/.test(item.threadId) && /^\d+$/.test(item.emailId))) items.push({ ...item, ...identify(item, gmail) });
      }
    }
    return items;
  });
}

function byMessage(rows) {
  const unique = new Map();
  for (const row of rows) if (!unique.has(row.message)) unique.set(row.message, row);
  return [...unique.values()].sort((a, b) => a.date - b.date || a.message.localeCompare(b.message));
}

function googleLabels(item) {
  return [...(item.labels ?? [])].map(label => /^\\inbox$/i.test(label) ? 'INBOX' : labelId(label));
}

async function readCatalog(client, folders, gmail, windowDays) {
  const visible = gmail ? folders.filter(folder => folder.path.toUpperCase() === 'INBOX' ||
    (!folder.specialUse && !/^\[(?:Gmail|GoogleMail)\](?:[/.]|$)/i.test(folder.path)))
    : folders.filter(folder => !VIRTUAL.has(folder.specialUse));
  const labels = visible.map(({ path }) => ({ path, id: labelId(path), name: /^inbox$/i.test(path) ? 'Inbox' : path,
    unread: 0 }));
  labels.sort((a, b) => a.id === 'INBOX' ? -1 : b.id === 'INBOX' ? 1 : a.name.localeCompare(b.name));
  const all = gmail ? mailboxPath(folders, '\\All') : undefined;
  if (gmail && !all) throw new MailError('all-mail-unavailable', 502);
  const rows = [];
  for (const path of gmail ? [all] : visible.map(folder => folder.path)) {
    for (const row of await readFolder(client, path, gmail, gmail ? { gmraw: `{newer_than:${windowDays}d is:unread}` } : {})) {
      rows.push(row);
    }
  }
  if (!gmail) threadGeneric(rows);
  const groups = new Map(), members = new Map(), unreadLabels = new Map();
  for (const row of rows) {
    if (!groups.has(row.thread)) groups.set(row.thread, []);
    groups.get(row.thread).push(row);
    for (const label of gmail ? googleLabels(row) : [labelId(row.path)]) {
      if (!members.has(label)) members.set(label, new Set());
      members.get(label).add(row.thread);
      if (!flags(row, '\\Seen')) {
        if (!unreadLabels.has(label)) unreadLabels.set(label, new Set());
        unreadLabels.get(label).add(row.thread);
      }
    }
  }
  const summaries = new Map(), messages = new Map(), unread = new Set();
  const cutoff = Date.now() - windowDays * 86_400_000;
  for (const [thread, copies] of groups) {
    const ordered = byMessage(copies), newest = ordered.at(-1);
    const firstFrom = newest.envelope?.from?.[0];
    const unseen = copies.some(row => !flags(row, '\\Seen'));
    summaries.set(thread, { id: thread, from: firstFrom?.name || firstFrom?.address || '',
      subject: ordered[0].envelope?.subject ?? '', date: newest.date, count: ordered.length,
      unread: unseen, starred: copies.some(row => flags(row, '\\Flagged')) });
    for (const item of ordered) messages.set(item.message, item);
    if (unseen) unread.add(thread);
  }
  for (const label of labels) label.unread = unreadLabels.get(label.id)?.size ?? 0;
  const order = new Set([...summaries.values()].filter(row => row.date >= cutoff)
    .sort((a, b) => b.date - a.date || a.id.localeCompare(b.id)).map(row => row.id));
  return { all, labels, groups, summaries, messages, order, members, unread };
}

function byMailbox(rows) {
  const batches = new Map();
  for (const item of rows) {
    if (!batches.has(item.path)) batches.set(item.path, []);
    batches.get(item.path).push(item);
  }
  return batches.values();
}

export function createImapAccount(account, shared, {
  createClient = newImap, createTransport = newSmtp, credentials = () => passwordFile(account), parse = parseMime,
} = {}) {
  const { snapshot, windowDays, imaging, fetchRemote, messageWithPictures } = shared;
  const selections = new Map(), moves = new Map(), sends = new Map(), recentlyRead = new Map();
  let queue = Promise.resolve();

  // Serialize operations and log out after each. Cached projections share a single catalog load;
  // each request uses a short-lived client whose selected folder is never shared across requests.
  function run(task) {
    const result = queue.then(task);
    queue = result.catch(() => {});
    return result;
  }

  async function withClient(task) {
    let client, connected;
    try {
      const options = tlsOptions(account.imap, account.address, await credentials());
      client = await createClient({ ...options, ...(options.secure ? {} : { doSTARTTLS: true }),
        connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000, disableAutoIdle: true });
      client.on('error', () => {}); // Protocol errors may embed server responses and credentials.
      await client.connect();
      connected = true;
      const gmail = client.capabilities.has('X-GM-EXT-1');
      return await task(client, gmail);
    } catch (error) {
      if (error instanceof MailError) throw error;
      if (error?.authenticationFailed || error?.code === 'EAUTH') throw new MailError('auth', 502);
      throw network();
    } finally {
      if (connected) { try { await client.logout(); } catch { /* Close below, even if LOGOUT failed. */ } }
      try { client?.close(); } catch { /* The socket is already finished. */ }
    }
  }

  async function folders(client, { hidden = false } = {}) {
    return (await client.list()).filter(folder => !folder.flags?.has('\\Noselect') &&
      (hidden || !HIDDEN.has(folder.specialUse)));
  }
  const health = snapshot(() => run(() => withClient(() => true)));
  const catalog = snapshot(() => run(() => withClient(async (client, gmail) =>
    readCatalog(client, await folders(client), gmail, windowDays))));
  function project(key) {
    return { refresh: catalog.refresh, get ready() { return catalog.ready; }, read: () => catalog.read()?.[key] };
  }
  function labelIndex(label, query) {
    const key = query ? `${label}:${query}` : label;
    if (!selections.has(key)) selections.set(key, !query ? {
      refresh: catalog.refresh, get ready() { return catalog.ready; },
      read: () => catalog.read()?.members.get(label),
    } : snapshot(() => run(() => withClient(async (client, gmail) => {
      // Generic IMAP TEXT searches within the selected folder; Gmail uses its native query grammar.
      const data = catalog.read() ?? await readCatalog(client, await folders(client), gmail, windowDays);
      const folder = data.labels.find(entry => entry.id === label);
      if (!folder) return new Set();
      const path = gmail ? data.all : folder.path;
      const result = await selected(client, path, async validity => ({
        validity, hits: new Set(await searchUids(client,
          gmail ? { gmraw: `newer_than:${windowDays}d (${query})` } : { text: query })),
      }));
      return new Set([...data.groups.entries()].filter(([, rows]) => rows.some(row =>
        row.path === path && row.validity === result.validity && result.hits.has(row.uid) &&
        (!gmail || googleLabels(row).includes(label)))).map(([thread]) => thread));
    }))));
    const index = selections.get(key);
    index.usedAt = Date.now();
    return index;
  }
  const invalidate = () => {
    catalog.invalidate(true);
    for (const index of selections.values()) index.invalidate?.(true);
  };
  const summary = thread => {
    const value = catalog.read()?.summaries.get(thread);
    return value ? { value: { ...value, account: account.id } } : { removed: true };
  };

  async function threadRows(client, gmail, thread, list) {
    if (gmail) {
      const all = mailboxPath(list, '\\All');
      if (!all || !/^gt_\d{1,20}$/.test(thread)) throw missing();
      return readFolder(client, all, true, { threadId: thread.slice(3) });
    }
    return (await readCatalog(client, list.filter(folder => !HIDDEN.has(folder.specialUse)), false, windowDays))
      .groups.get(thread) ?? [];
  }
  async function messageRows(client, gmail, thread) {
    const rows = await threadRows(client, gmail, thread, await folders(client));
    if (!rows.length) throw missing();
    return byMessage(rows);
  }

  const open = thread => run(() => withClient(async (client, gmail) => {
    const rows = await messageRows(client, gmail, thread);
    const messages = [];
    let subject;
    for (const row of rows) {
      const mail = await content(client, row, parse);
      subject ??= mail.subject;
      const { text, images } = messageWithPictures(mail.payload, mail.subject);
      messages.push({ id: row.message, from: parseFrom(mail.from), to: mail.to, cc: mail.cc, date: row.date,
        text, ...(images.length && { images }) });
    }
    return { subject, messages };
  }));

  async function latest(client, gmail, thread) {
    if (typeof thread !== 'string' || !/^[a-z0-9_-]+$/i.test(thread)) throw badRequest();
    const rows = await messageRows(client, gmail, thread);
    const mail = await content(client, rows.at(-1), parse);
    mail.text = bodyText(mail.payload, { subject: mail.subject });
    mail.subject = rows[0].envelope?.subject || mail.subject;
    return mail;
  }
  const compose = (thread, mode) => {
    if (!['reply', 'replyAll', 'forward'].includes(mode)) throw badRequest();
    return run(() => withClient(async (client, gmail) => replyFields(await latest(client, gmail, thread), mode, account.address)));
  };

  async function updateFlags(client, rows, method, flag, options = UID) {
    for (const batch of byMailbox(rows)) {
      await selected(client, batch[0].path, async () => {
        if (!await client[method](batch.map(row => row.uid), [flag], options)) throw network();
      }, false, batch[0].validity);
    }
  }

  function prune(entries) {
    for (const [key, entry] of entries) if (entry.at !== undefined && Date.now() - entry.at > UNDO_MS) entries.delete(key);
  }

  async function move(client, rows, path, remember) {
    if (!path) throw new MailError('folder-unavailable', 409);
    if (!client.capabilities.has('MOVE') && !client.capabilities.has('UIDPLUS')) {
      throw new MailError('move-unavailable', 409);
    }
    for (const batch of byMailbox(rows.filter(row => row.path !== path))) {
      const { path: source, validity } = batch[0];
      const applied = await selected(client, source, () => client.messageMove(batch.map(row => row.uid), path, UID),
        false, validity);
      if (!applied) throw network();
      for (const row of batch) {
        const uid = applied.uidMap?.get(row.uid);
        remember?.push({ source, path, uid, validity: applied.uidValidity, emailId: row.emailId,
          messageId: imapIds(row.envelope?.messageId)[0], labels: [...(row.labels ?? [])] });
      }
    }
  }

  async function restoreRow(client, item, gmail) {
    return selected(client, item.path, async validity => {
      if (item.uid && item.validity === validity) {
        const found = await searchUids(client, { uid: String(item.uid) });
        if (found.includes(item.uid)) return { ...item, validity };
      }
      const criterion = gmail ? item.emailId && { emailId: item.emailId } :
        item.messageId && { header: { 'Message-ID': item.messageId } };
      if (!criterion) throw new MailError('undo-unavailable', 409);
      const matches = await searchUids(client, criterion);
      // HEADER search is a substring match. Verify the actual ID and refuse ambiguous copies.
      const exact = gmail || !matches.length ? matches : (await client.fetchAll(matches, { envelope: true }, UID))
        .filter(row => imapIds(row.envelope?.messageId)[0] === item.messageId).map(row => row.uid);
      if (exact.length !== 1) throw new MailError('undo-unavailable', 409);
      return { ...item, uid: exact[0], validity };
    });
  }

  async function undo(client, journal, gmail) {
    while (journal.rows.length) {
      const item = journal.rows[0];
      const row = await restoreRow(client, item, gmail);
      await move(client, [row], item.source);
      journal.rows.shift();
    }
  }

  async function mutate(client, gmail, thread, action) {
    prune(moves);
    const list = await folders(client, { hidden: true });
    const trash = mailboxPath(list, '\\Trash');
    const all = mailboxPath(list, '\\All');
    const archive = mailboxPath(list, '\\Archive');
    const undoing = action === 'unarchive' || action === 'untrash';
    const original = action === 'unarchive' ? 'archive' : 'trash';
    const journalKey = `${thread}:${undoing ? original : action}`;
    const previous = moves.get(journalKey);
    if (undoing && previous && !(gmail && action === 'untrash')) {
      await undo(client, previous, gmail);
      moves.delete(journalKey);
      return;
    }
    if (action === 'untrash' && !gmail) throw new MailError('undo-unavailable', 409);
    const rows = gmail && action === 'untrash'
      ? trash && /^gt_\d{1,20}$/.test(thread) ? await readFolder(client, trash, true, { threadId: thread.slice(3) }) : []
      : await threadRows(client, gmail, thread, list);
    if (!rows.length && !(gmail && action === 'untrash' && previous?.rows.length)) throw missing();
    if (FLAGS.has(action)) return updateFlags(client, rows, ...FLAGS.get(action));
    if (gmail && (action === 'archive' || action === 'unarchive')) {
      // STORE X-GM-LABELS preserves Sent and user labels. Only change rows that need it.
      const affected = rows.filter(row => googleLabels(row).includes('INBOX') === (action === 'archive'));
      return updateFlags(client, affected, action === 'archive' ? 'messageFlagsRemove' : 'messageFlagsAdd',
        '\\Inbox', { ...UID, useLabels: true });
    }
    if (gmail && action === 'untrash') {
      // Moving out of Gmail Trash to Inbox restores the message. Use the saved Inbox membership
      // to remove the label on messages that had already been archived.
      if (rows.length) await move(client, rows, 'INBOX');
      if (previous?.rows.length && all) {
        const restored = new Map((await readFolder(client, all, true, { threadId: thread.slice(3) }))
          .map(row => [row.emailId, row]));
        const labelOptions = { ...UID, useLabels: true };
        for (const item of previous.rows) {
          const row = restored.get(item.emailId);
          if (!row) continue;
          for (const label of item.labels) {
            if (!label.startsWith('\\') && !row.labels?.has(label) && list.some(folder => folder.path === label)) {
              await updateFlags(client, [row], 'messageFlagsAdd', label, labelOptions);
            }
          }
          if (!item.labels.some(label => /^\\inbox$/i.test(label)) && googleLabels(row).includes('INBOX')) {
            await updateFlags(client, [row], 'messageFlagsRemove', '\\Inbox', labelOptions);
          }
        }
      }
      moves.delete(journalKey);
      return;
    }
    const from = action === 'archive' ? rows.filter(row => row.path.toUpperCase() === 'INBOX')
      : action === 'unarchive' ? rows.filter(row => row.path === archive) : rows;
    const journal = previous ?? { rows: [], at: Date.now() };
    try {
      await move(client, from, action === 'archive' ? archive : action === 'unarchive' ? 'INBOX' : trash, journal.rows);
    } finally {
      if (action !== 'unarchive' && journal.rows.length) moves.set(journalKey, journal);
    }
  }

  function act(thread, action) {
    if (!FLAGS.has(action) && !MOVES.has(action)) throw badRequest();
    return run(async () => {
      try {
        await withClient((client, gmail) => mutate(client, gmail, thread, action));
        return { ok: true };
      } finally {
        // Even a partial multi-folder write requires a refresh before serving another page.
        invalidate();
      }
    });
  }

  function send(input) {
    const draft = readDraft(input);
    prune(sends);
    if (sends.has(draft.sendId)) return sends.get(draft.sendId).result;
    const entry = {};
    const result = run(async () => {
      const id = `<${randomUUID()}@${account.address.split('@').at(-1)}>`;
      const sentAt = new Date();
      const build = origin => outgoing(draft, input.threadId, origin, { sender: { address: account.address }, sentAt, id });
      const encoded = draft.mode === 'new' ? await build() :
        await withClient((client, gmail) => build(thread => latest(client, gmail, thread)));
      const raw = Buffer.from(encoded, 'base64url');
      const options = tlsOptions(account.smtp, account.address, await credentials());
      let transport;
      try {
        transport = await createTransport({ ...options, requireTLS: !options.secure, debug: false,
          connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000 });
      } catch {
        throw network();
      }
      try {
        const to = [...draft.to, ...draft.cc].map(person => person.address);
        const accepted = await transport.sendMail({ envelope: { from: account.address, to }, raw });
        if (accepted?.rejected?.length) {
          entry.at = Date.now();
          throw new MailError('partial-send', 502);
        }
      } catch (error) {
        // A disconnect after DATA can leave delivery uncertain. Retain the outcome for this sendId
        // so a lost SMTP acknowledgement can never cause a duplicate within the retry window.
        if (error instanceof MailError) throw error;
        if (error?.code === 'EAUTH') throw new MailError('auth', 502);
        entry.at = Date.now();
        throw new MailError('send-uncertain', 502);
      } finally {
        try { transport.close?.(); } catch { /* Delivery was already decided. */ }
      }
      entry.at = Date.now();
      if (account.saveSent !== false) {
        // Sent filing is independent of delivery. Gmail records SMTP submissions by itself.
        await withClient(async (client, gmail) => {
          if (gmail && account.saveSent !== true) return;
          const path = mailboxPath(await folders(client), '\\Sent');
          if (path) await client.append(path, raw, ['\\Seen'], sentAt);
        }).catch(() => {});
      }
      invalidate();
      return { ok: true, id };
    });
    entry.result = result;
    sends.set(draft.sendId, entry);
    result.catch(() => { if (entry.at === undefined) sends.delete(draft.sendId); });
    return result;
  }

  async function image(message, partId, view, remote) {
    if (!imaging) throw new MailError('images-unavailable', 503);
    return imaging.render(`mail:${account.id}:${message}:${remote === undefined ? partId : `remote-${remote}`}`, async () => {
      const payload = await run(() => withClient(async (client, gmail) => {
        const list = await folders(client);
        let row;
        if (gmail) {
          const all = mailboxPath(list, '\\All');
          if (all && /^gm_\d{1,20}$/.test(message)) [row] = await readFolder(client, all, true, { emailId: message.slice(3) });
        } else row = (await readCatalog(client, list, false, windowDays)).messages.get(message);
        if (!row) throw missing();
        return (await content(client, row, parse)).payload;
      }));
      if (remote !== undefined) {
        const src = htmlImages(bodyHtml(payload))[remote]?.src ?? '';
        if (!/^https:\/\//i.test(src)) throw missing();
        try { return await fetchRemote(src); }
        catch (error) { throw new MailError(error?.message === 'remote-refused' ? 'remote-refused' : 'remote-failed', 502); }
      }
      const file = payload.parts.find(item => item.partId === partId);
      if (!file) throw missing();
      return Buffer.from(file.body.data, 'base64url');
    }, view);
  }

  return {
    id: account.id, short: account.short, address: account.address, health, labels: project('labels'),
    order: project('order'), unread: project('unread'), labelIndex, selections, recentlyRead, summary,
    sortDate: thread => summary(thread).value?.date ?? 0, open, mark: thread => act(thread, 'read'),
    act, compose, send, image,
  };
}
