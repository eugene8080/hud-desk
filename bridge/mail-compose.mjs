// Outgoing mail for the Email module (Eugene, 2026-11-27: compose, reply, reply all and forward
// from the glasses with a Bluetooth keyboard). Pure functions only: address parsing, reply
// recipients, the quoted original, and the RFC 5322 message that Gmail's messages.send takes.
// The bridge builds every header itself from validated fields, so the app cannot inject one.
import { MailError } from './gmail.mjs';

export const SEND_MODES = new Set(['new', 'reply', 'replyAll', 'forward']);
export const MAX_RECIPIENTS = 50;
export const MAX_SUBJECT = 998; // RFC 5322 line limit; the subject is encoded on its own anyway.
export const MAX_BODY = 50_000;
const ADDRESS = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]+$/;
const badRequest = () => new MailError('bad request', 400);
// CR, LF and other C0/C1 controls (except tab in a body) never reach a header.
const CONTROL = /[\u0000-\u0008\u000a-\u001f\u007f-\u009f]/;

// Splits a header-style list on commas outside quotes and angle brackets:
// 'A <a@x.test>, "B, C" <b@x.test>, c@x.test' -> three entries.
function splitList(value) {
  const parts = [];
  let current = '', quoted = false, angle = 0;
  for (const ch of value) {
    if (ch === '"' && !angle) quoted = !quoted;
    else if (ch === '<' && !quoted) angle++;
    else if (ch === '>' && !quoted && angle) angle--;
    if ((ch === ',' || ch === ';') && !quoted && !angle) { parts.push(current); current = ''; continue; }
    current += ch;
  }
  parts.push(current);
  return parts.map(part => part.trim()).filter(Boolean);
}

// One entry -> { name, address }, or null when it is not a usable address.
function parseEntry(entry) {
  const angled = /^(.*?)<([^<>]+)>\s*$/.exec(entry);
  const address = (angled ? angled[2] : entry).trim();
  if (!ADDRESS.test(address)) return null;
  const name = angled ? angled[1].trim().replace(/^"(.*)"$/, '$1').replace(/\\(.)/g, '$1').trim() : '';
  return { name, address };
}

// Typed or prefilled recipients. Throws on an entry that is not an address, so a typo is
// reported on the glasses instead of silently dropped.
export function parseAddresses(value) {
  if (value === undefined || value === null || value === '') return [];
  if (typeof value !== 'string' || CONTROL.test(value) || value.length > 10_000) throw badRequest();
  return splitList(value).map(entry => {
    const parsed = parseEntry(entry);
    if (!parsed) throw new MailError('bad address', 400);
    return parsed;
  });
}

// Header lists received from Gmail: invalid entries are skipped, not fatal.
function received(value) {
  if (typeof value !== 'string' || !value) return [];
  return splitList(value.replace(/\r?\n[ \t]*/g, ' ')).map(parseEntry).filter(Boolean);
}

const ascii = text => /^[\x20-\x7e]*$/.test(text);
// RFC 2047 encoded-word for non-ASCII text; chunks stay under the 75-character word limit.
function encodedWords(text) {
  const words = [];
  let chunk = '';
  for (const ch of text) {
    if (Buffer.byteLength(chunk + ch) > 45) { words.push(chunk); chunk = ''; }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words.map(word => `=?UTF-8?B?${Buffer.from(word).toString('base64')}?=`).join(' ');
}

export function formatAddress({ name, address }) {
  if (!name) return address;
  if (ascii(name)) return `"${name.replace(/["\\]/g, '\\$&')}" <${address}>`;
  return `${encodedWords(name)} <${address}>`;
}
export const formatList = list => list.map(formatAddress).join(', ');
const headerText = text => ascii(text) ? text : encodedWords(text);

const own = address => entry => entry.address.toLowerCase() === address.toLowerCase();
function unique(list) {
  const seen = new Set();
  return list.filter(entry => {
    const key = entry.address.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function replySubject(subject, mode) {
  const clean = String(subject ?? '').replace(/\s+/g, ' ').trim();
  if (mode === 'forward') return /^(fwd?|fw):/i.test(clean) ? clean : `Fwd: ${clean}`;
  return /^re:/i.test(clean) ? clean : `Re: ${clean}`;
}

// The To, Cc and Subject a reply, reply all or forward starts with, as Gmail fills them:
// reply goes to Reply-To or From, or to the original To when the last message was yours; reply
// all adds the other To and Cc recipients without your own address; forward starts empty.
export function replyFields(headers, mode, self) {
  const isSelf = own(self);
  const subject = mode === 'new' ? '' : replySubject(headers.subject, mode);
  if (mode === 'new' || mode === 'forward') return { to: '', cc: '', subject };
  const from = received(headers.from);
  const fromSelf = from.length > 0 && from.every(isSelf);
  const replyTo = received(headers.replyTo);
  const originalTo = received(headers.to);
  const primary = fromSelf ? originalTo : (replyTo.length ? replyTo : from);
  let to = unique(primary.filter(entry => !isSelf(entry)));
  let cc = [];
  if (mode === 'replyAll') {
    const others = fromSelf ? [] : originalTo;
    to = unique([...to, ...others.filter(entry => !isSelf(entry))]);
    const inTo = new Set(to.map(entry => entry.address.toLowerCase()));
    cc = unique(received(headers.cc).filter(entry => !isSelf(entry) && !inTo.has(entry.address.toLowerCase())));
  }
  // A reply to a message you sent to yourself goes back to you.
  if (!to.length && fromSelf) to = from.slice(0, 1);
  return { to: formatList(to), cc: formatList(cc), subject };
}

function quoteDate(timestamp) {
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime()) ? date.toUTCString() : '';
}

// The original below a reply ("On <date>, <from> wrote:" and '> ' lines) or a forward (Gmail's
// forwarded-message block). Attachments are not forwarded; the block says so when there were any.
export function quotedOriginal(original, mode) {
  const text = String(original.text ?? '').replace(/\r\n?/g, '\n');
  if (mode === 'forward') {
    return ['', '', '---------- Forwarded message ---------', `From: ${original.from}`, `Date: ${original.date}`,
      `Subject: ${original.subject}`, `To: ${original.to}`, ...(original.cc ? [`Cc: ${original.cc}`] : []),
      ...(original.attachments ? ['(Attachments not forwarded)'] : []), '', text].join('\n');
  }
  const when = quoteDate(original.timestamp);
  return ['', '', `On ${when ? `${when}, ` : ''}${original.from} wrote:`, ...text.split('\n').map(line => `> ${line}`)].join('\n');
}

// Base64 body lines of 76 characters (RFC 2045).
const wrap76 = text => text.match(/.{1,76}/g)?.join('\r\n') ?? '';
const messageId = value => /^<[^<>\s]+>$/.test(String(value ?? '').trim()) ? String(value).trim() : '';

// The raw message for messages.send, base64url-encoded. Gmail adds From (your default send-as
// name and address), Date and Message-ID.
export function buildRaw({ to, cc, subject, body, inReplyTo = '', references = '' }) {
  const lines = [];
  if (to.length) lines.push(`To: ${formatList(to)}`);
  if (cc.length) lines.push(`Cc: ${formatList(cc)}`);
  lines.push(`Subject: ${headerText(subject)}`);
  const parent = messageId(inReplyTo);
  if (parent) {
    const chain = String(references ?? '').split(/\s+/).filter(id => /^<[^<>\s]+>$/.test(id) && id !== parent);
    lines.push(`In-Reply-To: ${parent}`, `References: ${[...chain, parent].join(' ')}`);
  }
  lines.push('MIME-Version: 1.0', 'Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '',
    wrap76(Buffer.from(body.replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64')));
  return Buffer.from(lines.join('\r\n'), 'utf8').toString('base64url');
}

// Validates what the app sends; returns the parsed recipients and text.
export function readDraft(input) {
  const mode = input?.mode;
  if (!SEND_MODES.has(mode)) throw badRequest();
  const to = parseAddresses(input.to);
  const cc = parseAddresses(input.cc);
  if (!to.length && !cc.length) throw new MailError('no recipient', 400);
  if (to.length + cc.length > MAX_RECIPIENTS) throw new MailError('too many recipients', 400);
  const subject = input.subject ?? '';
  const body = input.body ?? '';
  if (typeof subject !== 'string' || CONTROL.test(subject) || subject.length > MAX_SUBJECT) throw badRequest();
  if (typeof body !== 'string' || body.length > MAX_BODY || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(body)) throw badRequest();
  if (!/^[a-zA-Z0-9-]{8,64}$/.test(String(input.sendId ?? ''))) throw badRequest();
  return { mode, to, cc, subject: subject.trim(), body, sendId: input.sendId };
}
