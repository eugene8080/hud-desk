// 接続コードで解決した中継サーバ(bridge/server.mjs)の API クライアント。
import { demoCall } from './demo';
import type { Lang } from './i18n';
import { createRelayTransport, type RelayPairing } from './relay-transport';
let token = '';
let base = '';

let lang: Lang = 'en';
let demo = false;

export function setApiLang(l: Lang) {
  lang = l;
}

// デモモードでは通信せず、アプリ内の架空データを返す
export function setDemo(on: boolean) {
  demo = on;
}

let resolveBase: (() => Promise<string | null>) | null = null;
let relay: ReturnType<typeof createRelayTransport> | null = null;

export function setConnection(c: { base: string } &
  ({ token: string; resolve?: () => Promise<string | null> } | { relay: RelayPairing })) {
  base = c.base.replace(/\/+$/, '');
  token = 'token' in c ? c.token : '';
  resolveBase = 'token' in c ? c.resolve ?? null : null;
  relay = 'relay' in c ? createRelayTransport(base, c.relay) : null;
}

export const currentBase = () => base;

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown, timeoutMs = method === 'GET' ? 8000 : 0): Promise<T> {
  if (demo) return demoCall(lang, method, path, body) as T;
  if (!base) throw new Error('Bridge is not connected');
  const binary = body instanceof Uint8Array;
  const urlPath = `${path}${path.includes('?') ? '&' : '?'}lang=${lang}`;
  const contentType = binary ? 'application/octet-stream' : 'application/json';
  const relayRequest = relay;
  const req = () =>
    relayRequest ? relayRequest(method, urlPath,
      binary ? body : body ? new TextEncoder().encode(JSON.stringify(body)) : undefined, contentType, timeoutMs) :
    fetch(`${base}${urlPath}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': contentType,
      },
      body: binary ? (body as BodyInit) : body ? JSON.stringify(body) : undefined,
      // A read stalled by the phone radio must not pin the glasses poll until the screen is on.
      signal: timeoutMs && typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(timeoutMs) : undefined,
    });
  let res: Response;
  try {
    res = await req();
  } catch (e) {
    // A disconnected POST may already have delivered input. Never replay it.
    if (method === 'POST') throw new Error('Delivery uncertain. Reopen the thread before sending again.');
    // つながらない = トンネルの URL が変わった可能性。連絡板で最新を引き直して1回だけやり直す
    const next = resolveBase && (await resolveBase().catch(() => null));
    if (!next || next === base) throw e;
    base = next;
    res = await req();
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data as T;
}

export type Thread = { handle: string; title: string; agent: string; state: 'idle' | 'busy' | 'unknown'; workspaceId?: string; workspaceName?: string; workspaceLabel?: string; lastOutputAt?: number; hermesGroup?: 'bot' | 'session' | 'job'; readOnly?: boolean };
export type ChoiceMenu = { id: string; question: string; options: { value: string; label: string; description?: string }[] };
export type Provider = { id: string; models: string[]; ok: boolean; note: string };
export type Workspace = { id: string; name: string; lastActivityAt?: number; hermes?: 'bot' | 'session' | 'job' };
export type Activity = 'working' | 'waiting' | 'attention' | 'unknown';
export type UsageLimit = { usedPercent: number; resetDescription: string; resetsAt?: number | null; computerResetDescription?: string };
type Limit = UsageLimit | null;
export type Usage = Record<string, { provider?: string; status: string; error?: string | null; session?: Limit; weekly?: Limit; monthly?: Limit }>;
// address: the mailbox address (bridges before 1.0.62 send only the short letter).
export type MailAccount = { id: string; short: string; address?: string; ok: boolean; error?: string };
export type MailLabel = { id: string; name: string; unread: number };
export type MailThread = { account: string; id: string; from: string; subject: string; date: number; unread: boolean; count: number; starred?: boolean };
// Keyboard actions on a thread (2026-11-27); 'unarchive'/'untrash' undo 'archive'/'trash'.
export type MailAction = 'archive' | 'unarchive' | 'trash' | 'untrash' | 'unread' | 'read' | 'star' | 'unstar';
export type MailSend = { account: string; mode: 'new' | 'reply' | 'replyAll' | 'forward'; threadId?: string;
  to: string; cc: string; subject: string; body: string; sendId: string };
// loading: the bridge's cold-start wait ran out and the page is incomplete (bridges before 1.0.65 omit it).
export type MailPage = { items: MailThread[]; hasMore: boolean; unread: number; loading?: boolean };
export type MailConversation = { subject: string; messages: { id: string; from: string; to: string; cc: string; date: number; text: string;
  images?: { part?: string; remote?: number; name: string }[] }[] };
// A picture for the glasses (2026-11-27): 576x288, two 4-bit panel levels a byte, base64; mean
// brightness 0..1 (the app shows a mostly white picture in negative by default).
export type GlassImage = { width: number; height: number; data: string; mean: number; view?: string; regions?: number; region?: number; negative?: boolean };
// The viewer asks for a view (fit, zoom, outline, read) and, in zoom, a section; read answers with text.
// negative: 'on'/'off', or left out for automatic (the bridge decides; 1.0.84).
export type ImageRequest = { view?: 'fit' | 'zoom' | 'outline' | 'read'; region?: number; negative?: 'on' | 'off' };
export type ImageAnswer = GlassImage & { text?: string };
const viewQuery = (request: ImageRequest) => ({ ...(request.view && { view: request.view }), ...(request.region !== undefined && { region: String(request.region) }),
  ...(request.negative && { negative: request.negative }) });
// Optional Chat features the bridge PC can serve; a bridge before 1.0.72 omits this (both offered).
export type ChatFeatures = { transcribe: boolean; translate: boolean };
// network: the chat app (WhatsApp, Signal, ...); bridges before 1.0.86 do not send it.
export type ChatItem = { id: string; title: string; date: number; unread: boolean; readOnly?: boolean; network?: string };
export type ChatPage = { items: ChatItem[]; hasMore: boolean; unread: number };
export type ChatMessage = {
  id?: string;
  from: string;
  own: boolean;
  date: number;
  text: string;
  media?: 'Voice' | 'Audio' | 'Photo' | 'Video' | 'Sticker' | 'File' | 'Location';
  voice?: { id?: string; duration?: number; transcript?: string; language?: string };
  image?: boolean;
};
export type ChatConversation = { messages: ChatMessage[] };
// textLines (1.0.89): the English for each line of the message text, null where none is needed.
export type ChatTranslation = { id: string; text?: string | null; textLines?: (string | null)[] | null; voice?: string | null };

export const api = {
  capabilities: () => call<{ voice: boolean; modules?: string[]; chatFeatures?: ChatFeatures; imageRead?: boolean }>('GET', '/api/capabilities'),
  chat: {
    networks: () => call<string[]>('GET', '/api/chat/networks'),
    list: (networks: string[], page: number) => call<ChatPage>('GET', `/api/chat/list?${new URLSearchParams({ networks: networks.join(','), page: String(page) })}`),
    messages: (id: string) => call<ChatConversation>('GET', `/api/chat/messages?${new URLSearchParams({ id })}`),
    transcribe: (chatId: string, messageId: string) =>
      call<{ text: string; language: string }>('POST', '/api/chat/transcribe', { chatId, messageId }, 360000),
    translate: (chatId: string, messageIds: string[]) =>
      call<{ items: ChatTranslation[] }>('POST', '/api/chat/translate', { chatId, messageIds }, 240000),
    send: (chatId: string, text: string) => call<{ ok: boolean }>('POST', '/api/chat/send', { chatId, text }),
    read: (chatId: string) => call<{ ok: boolean }>('POST', '/api/chat/read', { chatId }),
    image: (chatId: string, messageId: string, request: ImageRequest = {}) =>
      call<ImageAnswer>('POST', '/api/chat/image', { chatId, messageId, ...request }, 200000),
  },
  mail: {
    accounts: () => call<MailAccount[]>('GET', '/api/mail/accounts'),
    labels: (account: string) => call<MailLabel[]>('GET', `/api/mail/labels?${new URLSearchParams({ account })}`),
    threads: (filter: string[], page: number, size = 8) => call<MailPage>('GET', `/api/mail/threads?${new URLSearchParams({ filter: filter.join(','), page: String(page), size: String(size) })}`),
    thread: (account: string, id: string) => call<MailConversation>('GET', `/api/mail/thread?${new URLSearchParams({ account, id })}`),
    read: (account: string, threadId: string) => call<{ ok: boolean }>('POST', '/api/mail/read', { account, threadId }),
    modify: (account: string, threadId: string, action: MailAction) => call<{ ok: boolean }>('POST', '/api/mail/modify', { account, threadId, action }),
    compose: (account: string, id: string, mode: 'reply' | 'replyAll' | 'forward') =>
      call<{ to: string; cc: string; subject: string }>('GET', `/api/mail/compose?${new URLSearchParams({ account, id, mode })}`),
    // The bridge sends a given sendId at most once, so a retry after a lost answer is safe.
    // ref: an attached part, or the K-th <img> the HTML links to (remote).
    image: (account: string, message: string, ref: { part?: string; remote?: number }, request: ImageRequest = {}) =>
      call<ImageAnswer>('GET', `/api/mail/image?${new URLSearchParams({ account, message,
        ...(ref.remote !== undefined ? { remote: String(ref.remote) } : { part: ref.part ?? '' }), ...viewQuery(request) })}`, undefined, 200000),
    send: (draft: MailSend) => call<{ ok: boolean; id?: string }>('POST', '/api/mail/send', draft, 30000),
  },
  health: () => call<{ ok: boolean }>('GET', '/healthz'),
  threads: () => call<Thread[]>('GET', '/api/threads'),
  activity: (handle: string) => call<{ state: Activity; elapsedSeconds?: number | null }>('GET', `/api/activity?handle=${encodeURIComponent(handle)}`),
  historyImage: (handle: string, index: number, request: ImageRequest = {}) =>
    call<ImageAnswer>('GET', `/api/history/image?${new URLSearchParams({ handle, index: String(index), ...viewQuery(request) })}`, undefined, 200000),
  history: (handle: string) => call<{ text: string; model?: string; source?: string; limited?: boolean; messageCount?: number; reason?: string }>('GET', `/api/history?handle=${encodeURIComponent(handle)}`),
  thread: (handle: string) => call<{ text: string; menu?: ChoiceMenu | null; progress?: string; model?: string }>('GET', `/api/thread?handle=${encodeURIComponent(handle)}`),
  choice: (handle: string, menuId: string, value: string) => call<{ sent: string }>('POST', '/api/choice', { handle, menuId, value }),
  replies: () => call<string[]>('GET', '/api/replies'),
  reply: (handle: string, index: number) => call<{ sent: string }>('POST', '/api/reply', { handle, index }),
  transcribe: (pcm: Uint8Array) => call<{ text: string }>('POST', '/api/transcribe', pcm),
  say: (handle: string, text: string) => call<{ sent: string }>('POST', '/api/say', { handle, text }),
  usage: () => call<Usage>('GET', '/api/usage'),
  providers: () => call<Provider[]>('GET', '/api/providers'),
  workspaces: () => call<Workspace[]>('GET', '/api/workspaces'),
  prompts: () => call<string[]>('GET', '/api/prompts'),
  startSession: (req: { workspaceId: string; agent: string; model: string; prompt: number }) =>
    call<{ handle: string; sent: boolean; reason?: string }>('POST', '/api/session', req),
};
