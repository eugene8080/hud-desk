// Typed drafts shown on the glasses (Eugene, 2026-11-27: Bluetooth keyboard, Gmail-style compose,
// reply, reply all and forward). The phone page holds the real text boxes, so the browser does
// the editing (cursor keys, selection, auto-repeat, IME); the glasses show the draft as it is
// typed. Pure helpers only; the screen and the keys are in main.ts.
import { t } from './i18n';

export type MailMode = 'new' | 'reply' | 'replyAll' | 'forward';
export type ComposeField = 'to' | 'cc' | 'subject' | 'body';
export type ComposeFields = Record<ComposeField, string>;
export const MAIL_FIELDS: ComposeField[] = ['to', 'cc', 'subject', 'body'];
export const emptyFields = (): ComposeFields => ({ to: '', cc: '', subject: '', body: '' });

// Marks the cursor while the text is wrapped into pages; replaced by CURSOR before display.
// A private-use code point, so it never collides with typed text.
export const CURSOR_MARK = '';
export const CURSOR = '|';

// The draft as the glasses show it: a title row, then To, Cc and Subject for mail, a blank row
// and the message. `focus`/`cursor` place the cursor mark in the field being typed in.
export function composeText(title: string, fields: ComposeFields, mail: boolean, focus?: ComposeField, cursor?: number): string {
  const mark = (field: ComposeField) => {
    const value = fields[field];
    if (focus !== field) return value;
    const at = Math.max(0, Math.min(cursor ?? value.length, value.length));
    return value.slice(0, at) + CURSOR_MARK + value.slice(at);
  };
  const body = mark('body').replace(/\r\n?/g, '\n');
  if (!mail) return [title, '', body || (focus === 'body' ? '' : ' ')].join('\n');
  return [title, t('composeToLine', mark('to')), t('composeCcLine', mark('cc')), t('composeSubjectLine', mark('subject')), '', body].join('\n');
}

// The recipients the app can check before the bridge does: at least one address in To or Cc.
export function hasRecipient(fields: ComposeFields): boolean {
  return /\S+@\S+/.test(fields.to) || /\S+@\S+/.test(fields.cc);
}

// A send id is generated once per draft and kept across retries, so the bridge sends it at most
// once even when Enter is pressed twice or an answer is lost.
export function newSendId(random: () => number = Math.random, now: () => number = Date.now): string {
  return `og-${now().toString(36)}-${Math.floor(random() * 2 ** 32).toString(36)}`;
}

// Bridge error codes from POST /api/mail/send, as the glasses say them.
export function sendError(message: string): string {
  if (/bad address/.test(message)) return t('composeBadAddress');
  if (/no recipient/.test(message)) return t('composeNoRecipient');
  if (/too many recipients/.test(message)) return t('composeTooMany');
  return t('composeNotSent', message);
}
