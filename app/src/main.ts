import {
  AudioInputSource,
  CreateStartUpPageContainer,
  ListContainerProperty,
  ListItemContainerProperty,
  MenuContainerProperty,
  MenuItemProperty,
  ImageContainerProperty,
  ImageRawDataUpdate,
  ImageRawDataUpdateResult,
  OsEventTypeList,
  RebuildPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
  type EvenAppBridge,
  type EvenHubEvent,
} from '@evenrealities/even_hub_sdk';
import { api, currentBase, setApiLang, setConnection, setDemo, type ChatFeatures, type ChatItem, type GlassImage, type ImageAnswer, type ImageRequest, type ChoiceMenu, type MailAction, type MailThread, type Provider, type Thread, type Usage, type Workspace } from './api';
import { parseCode, resolveBase } from './pairing';
import { applyPage, detectLang, getLang, setLang, t as tr } from './i18n';
import { clipBytes, tailBytes, textSections, readerPages, latestResponseStart, choiceNumber, readerContent, glassTextWidth, type ReaderPage } from './text';
import { readerStatus, statusPixels, SPINNER, workingLabels } from './reader-status';
import { statusRight } from './footer-hint';
import { formatReset, RESET_MODES, resetModeLabel, type ResetMode } from './usage-reset';
import { orcaAgents, workspaceSections, toggleWorkspace, workspaceSummary, type PickerRow } from './filters';
import { createPhone, type Connection } from './phone';
import { FINE_FONTS, FINE_TILES, fineLabel, alignMarkdownTables, SCANNER_WIDTH, fineLayout, fineMeasure, fineCells, renderFineScreen, renderFontComparison, renderBackgroundComparison, fontSample, FONTS_BY_SIZE, captionTiles, renderKeysPage, renderTextPage, renderUsagePage, type UsagePage, inkByte, nativeTextColor, parseInk, DEFAULT_TURN_BACKGROUND, TURN_BACKGROUNDS, parseTurnBackground, turnBackgroundLabel, type FineFont, type FineStatus, type TurnBackground } from './fine-text';
import { agentLabel, sessionRow, sessionHeading, moduleHeading, moduleButton, moduleLabel, offeredModules, nextModule, MENU_HEAD, MENU_COUNT, MENU_LEFT, MENU_RIGHT, MENU_CURSOR, MENU_DOTS, sessionAgentLabel, menuNativeText, menuCursorText, nativeRight, glassWidth, compactSessionTitle, type GlassModule, type ModulePosition, type SessionColumns } from './session-list';
import { Mail, mailColumns, imageNumbers, MAIL_ACCOUNTS_KEY, MAIL_LABELS_KEY, type ReaderContent, type ReaderSource } from './mail';
import { Chat, ChatReader, chatColumns, CHAT_NETWORKS_KEY, CHAT_TRANSLATE_KEY } from './chat';
import { composeText, CURSOR, CURSOR_MARK, emptyFields, hasRecipient, MAIL_FIELDS, newSendId, sendError, type ComposeField, type ComposeFields, type MailMode } from './compose';

// 画面 576x288。上に見出し(テキスト)、下に本文(リスト or テキスト)の2段構成で統一する。
const HEAD = { containerID: 1, containerName: 'head', xPosition: 0, yPosition: 0, width: 576, height: 36 };
const BODY = { containerID: 2, containerName: 'body', xPosition: 0, yPosition: 40, width: 576, height: 248 };
// Reader: nine 27px chat rows (y4..247), a divider at y250 and one status row
// (y254..281). Status (left, 'voice') and hint/page (right, 'hint') share that
// row as two transparent text layers; their combined width is fitted to the row.
const READER_ROWS = 9;
const READER_TOP = 4;
const READER_HEIGHT = READER_ROWS * 27;
const STATUS_ROW_Y = 254;
const VOICE = { containerID: 3, containerName: 'voice', xPosition: 16, yPosition: STATUS_ROW_Y, width: 544, height: 28 };
const FRAME = { containerID: 4, containerName: 'frame', xPosition: 0, yPosition: 0, width: 576, height: 288 };
// Frame and divider are single-pixel lines (user request 2026-11-09).
const DIVIDER = { containerID: 5, containerName: 'divider', xPosition: 16, yPosition: 250, width: 544, height: 1 };
const HINT = { containerID: 6, containerName: 'hint', xPosition: 280, yPosition: STATUS_ROW_Y, width: 280, height: 28 };
const STATUS_ICON = { containerID: 7, containerName: 'status-icon', xPosition: 16, yPosition: STATUS_ROW_Y, width: 20, height: 28 };
// Full-screen voice page: the same nine rows hold the scrollable transcript and
// the status row holds the instruction. IDs/layers are contiguous from 1/0.
const VOICE_BODY = { containerID: 1, containerName: 'voice-body', xPosition: 8, yPosition: READER_TOP, width: 560, height: READER_HEIGHT };
const VOICE_HINT = { containerID: 2, containerName: 'voice-hint', xPosition: 16, yPosition: STATUS_ROW_Y, width: 544, height: 28 };
const VOICE_FRAME = { ...FRAME, containerID: 3, containerName: 'voice-frame' };
const VOICE_DIVIDER = { ...DIVIDER, containerID: 4, containerName: 'voice-divider' };
// Small-text reader: the whole screen is four 288x144 image tiles (IDs 2..5)
// over one blank, full-screen text container (ID 1) that receives swipes.
const FINE_CAPTURE = { containerID: 1, containerName: 'fine-input', xPosition: 0, yPosition: 0, width: 576, height: 288 };
const FINE_TILE_IDS = FINE_TILES.map((tile, i) => ({ ...tile, containerID: 2 + i, containerName: `fine-${i}` }));
const FINE_NATIVE_ROW = { containerID: 6, containerName: 'fine-native', xPosition: 4, yPosition: 2, width: 568, height: 28 };
const LIST_ITEM_BYTES = 63;
const LIST_MAX = 20;
const TEXT_BYTES = 999;
const POLL_MS = 1000;

type Screen =
  | { kind: 'list'; title: string; items: string[]; module?: GlassModule; workspacePicker?: boolean; mailPicker?: { page: number; search: string }; chatPicker?: { page: number; networks: string[] }; agentPicker?: boolean; textPicker?: boolean; headings?: number[]; menuActions?: { id: number; label: string; run: (up?: Up) => unknown }[]; compat?: boolean; columns?: SessionColumns[]; count?: string; firstItem?: number; mailItems?: MailThread[]; selected?: number; paintedSelection?: number; menuFrame?: number; paintedCursor?: string; cursorWriting?: boolean; paging?: boolean; onPreviousPage?: () => unknown; onNextPage?: () => unknown; onPick: (i: number) => void; onBack?: () => void; onHold?: () => void }
  | { kind: 'text'; title: string; text: string; usagePage?: UsagePage; conversationText?: string; choiceMenu?: ChoiceMenu | null; tail?: boolean; offset?: number; pageText?: string; pages?: ReaderPage[]; pageTarget?: number; pageWriting?: boolean; reading?: boolean; refreshing?: boolean; responsePage?: number; openAtResponse?: boolean; openingOffset?: number; voiceLines?: { id: string; line: number }[]; model?: string; voice?: boolean; voiceHint?: string; voiceTail?: boolean; activityLabel?: string; activityState?: string; reportedSeconds?: number | null; statusFrame?: number; statusStartedAt?: number; savedHistory?: boolean; reader?: ReaderSource & { coding?: Thread }; fine?: FineFont; pagesFine?: FineFont; tiles?: number[][]; fineLabel?: string; fineQueued?: boolean; comparison?: Comparison; compareSelected?: number; imageView?: ImageView; keysPage?: boolean; menuActions?: { id: number; label: string; run: (up?: Up) => unknown }[]; onClick?: () => void; onBack?: () => void; };

let bridge: EvenAppBridge;
let current: Screen | null = null;
let started = false;
let compactMenuOnly = false;
// Aligned-menu rejections in a row (Eugene, 2026-11-27: right columns stopped being right-aligned and
// titles were cut off, i.e. the compact fallback, after fast keyboard use). One rejection no longer
// latches the compact menu for the rest of the run: it takes three in a row, and an accepted aligned
// page clears the count.
let alignedRejections = 0;
const COMPACT_AFTER = 3;
// Page rebuilds one at a time: fast keys could start a rebuild while the previous one was in
// flight, and the glasses rejected one of them.
let pageBuilds: Promise<unknown> = Promise.resolve();
function rebuildPage(page: object): Promise<boolean> {
  const run = pageBuilds.then(() => bridge.rebuildPageContainer(new RebuildPageContainer(page as never)));
  pageBuilds = run.catch(() => false);
  return run;
}
let poll: ReturnType<typeof setInterval> | undefined;
let menuPoll: ReturnType<typeof setInterval> | undefined;
let menuAnimation: ReturnType<typeof setInterval> | undefined;
let statusAnimation: ReturnType<typeof setInterval> | undefined;
let readerWrites: Promise<void> = Promise.resolve();
let panelWrites: Promise<void> = Promise.resolve();
let sessionCursorWrites: Promise<void> = Promise.resolve();
let modules: GlassModule[] = ['coding'];
let activeModule: GlassModule = 'coding';
const positions: Record<GlassModule, ModulePosition> = {
  coding: { page: 0, cursor: 0 }, email: { page: 0, cursor: 0 }, chat: { page: 0, cursor: 0 },
};
let moduleTimer: ReturnType<typeof setTimeout> | undefined;
let moduleRevision = 0;
let modulePending = false;
let mail: Mail;
let chat: Chat;
let voiceAvailable = false;
let moduleStorageWrites = Promise.resolve();
let mailStorageWrites = Promise.resolve();
let mailFilterRevision = 0;
let chatFilterRevision = 0;
let chatStorageWrites = Promise.resolve();
let selectedThread: Thread | null = null;
let sending = false;
let holding = false;
let releaseCapture: (() => void) | null = null;
let viewProvider = 'all';
// Reader text: the firmware's native font, or small text drawn as image tiles.
type ReaderText = 'native' | FineFont;
// The full-screen picture viewer (2026-11-27): image n of count from the reader's source.
type ImageMode = 'fit' | 'zoom' | 'outline' | 'read';
// Original Picture, Zoom, Outline, AI Readout (Eugene, 2026-11-27: Outline kept for now with thin,
// 1px lines; he may drop it after trying them).
const IMAGE_VIEWS: ImageMode[] = ['fit', 'zoom', 'outline', 'read'];
const IMAGE_VIEW_LABEL = { fit: 'imageViewFit', zoom: 'imageViewZoom', outline: 'imageViewOutline', read: 'imageViewRead' } as const;
type ImageView = { n: number; count: number; numbers: number[]; load: (n: number, request?: ImageRequest) => Promise<ImageAnswer>;
  mode: ImageMode; region: number; regions: number; image?: GlassImage; text?: string; textPage: number; invert?: boolean; note: string };
// Read is offered when the bridge has a vision model (bridges before 1.0.83 do not say: offered).
let imageReadOffered = true;
type Comparison = 'fonts' | 'backgrounds';
const DEFAULT_SMALL_FONT: FineFont = 'terminus';
const REMOVED_FONTS = ['fixed9', 'gohu14', 'shinonome'];
let readerText: ReaderText = 'native';
// The small font the menu offers when native text is on (last one used).
let smallFont: FineFont = DEFAULT_SMALL_FONT;
let turnBackground: TurnBackground = DEFAULT_TURN_BACKGROUND;
// Halo (2026-11-27): background pixels near a letter stay dark; a toggle in the Background menu.
// On by default (Eugene, 2026-11-27, with the 2 px halo of 1.0.84). Saved under a new key, so a
// Halo turned off in 1.0.79-1.0.83 (the 1 px version) comes back on once.
let turnHalo = true;
const HALO_KEY = 'reader-halo';

// One layer at a time (Eugene, 2026-11-27: "you exit one layer at a time"). A page opened from an
// app-drawn menu (Ctrl+, or Ctrl+Shift+P) goes back to that menu, not to the screen under it.
// `Up` reopens the menu. Single pages take it as an argument; pickers that redraw themselves
// (paging, toggles, typed search, a phone or language change) keep it in `pageUp` until they are
// left, and every way into such a picker sets or clears it first. The glasses' long-press menu is
// drawn by the firmware and cannot be reopened by an app, so its pages still go back to the screen.
type Up = () => unknown;
type UpPage = 'agents' | 'workspaces' | 'mailLabels' | 'chatNetworks' | 'usage' | 'newSession';
const pageUp: Partial<Record<UpPage, Up>> = {};
function enterPage(page: UpPage, up?: Up) {
  if (up) pageUp[page] = up;
  else delete pageUp[page];
}
function leavePage(page: UpPage, fallback: Up): unknown {
  const up = pageUp[page];
  delete pageUp[page];
  return (up ?? fallback)();
}
// Email has no turns of yours: Dim replies would dim the whole mail, so its reader shows None.
const backgroundFor = (s: TextScreen): TurnBackground => turnBackground === 'dimreplies' && s.reader?.mail ? 'none' : turnBackground;
// Reader ink, panel steps 1..15. 15 is full white. 0 is not offered: it would blank the font and frame. This is not the system brightness.
let inkLevel = 15;
const textBrightness = () => nativeTextColor(inkLevel);
let usageResetMode: ResetMode = 'computer';
let viewWorkspaces: Set<string> | null = null;
// Hermes is not part of Orca: it has its own workspace selection and page.
let viewHermesWorkspaces: Set<string> | null = null;
const hermesView = () => viewProvider === 'hermes';
const activeWorkspaces = () => hermesView() ? viewHermesWorkspaces : viewWorkspaces;
function setActiveWorkspaces(value: Set<string> | null) {
  moduleCache.delete('coding');
  if (hermesView()) viewHermesWorkspaces = value; else viewWorkspaces = value;
}
const saveWorkspaces = (hermes: boolean, value: Set<string> | null) =>
  bridge.setLocalStorage(hermes ? 'view-hermes-workspaces' : 'view-workspaces', value === null ? 'all' : JSON.stringify([...value]));
// A glasses change also redraws the phone page's filters.
const saveActiveWorkspaces = async () => { await saveWorkspaces(hermesView(), activeWorkspaces()); phone?.render(); };
let phone: ReturnType<typeof createPhone> | null = null;

// A phone change redraws whichever filter-dependent glasses page is showing.
function refreshGlasses() {
  moduleCache.delete('coding');
  positions.coding.page = 0;
  const s = current;
  if (s?.kind === 'list' && s.module === 'coding' && !modulePending) void home(0, 0);
  else if (s?.kind === 'list' && s.workspacePicker && !s.mailPicker && !s.chatPicker) void workspaceOptions();
  else if (s?.kind === 'list' && s.agentPicker) void viewOptions();
}
const providerFilterLabel = () => viewProvider === 'all' ? tr('allOrcaSessions') : agentLabel(viewProvider);
let workspaceNames = new Map<string, string>();
const providerName = agentLabel;

// The phone's reply box sends to the Coding session or the Chat chat open on the glasses
// (Chat added 2026-11-27 for Bluetooth-keyboard typing).
type ReplyTarget = { key: string; label: string; readOnly?: boolean; send: (text: string) => Promise<void> };
let replyTarget: ReplyTarget | null = null;
function setReplyTarget(target: ReplyTarget | null) {
  if (replyTarget?.key !== target?.key) {
    (document.getElementById('reply-text') as HTMLTextAreaElement).value = '';
    document.getElementById('send-reply')!.hidden = true;
    document.getElementById('reply-status')!.textContent = '';
  }
  replyTarget = target;
  document.getElementById('composer')!.hidden = !target || !!target.readOnly;
  document.getElementById('reply-target')!.textContent = target?.label ?? '';
}

function selectThread(t: Thread | null) {
  // The open chat has to survive the phone recreating this page with the screen off.
  if (selectedThread?.handle !== t?.handle) void bridge.setLocalStorage('open-thread', t?.handle || '');
  selectedThread = t;
  setReplyTarget(t ? { key: t.handle, label: tr('replyTo', t.title, t.handle.slice(-8)), readOnly: t.readOnly,
    send: async text => { await api.say(t.handle, text); } } : null);
}

// Reader body is 560px wide with no padding. 560px rows fit in the simulator; keep
// 8px (under one glyph) in case hardware rendering differs slightly.
const READER_WRAP_WIDTH = 552;
type TextScreen = Extract<Screen, { kind: 'text' }>;
const readerChars = (text: string) => text.replace(/\s/g, '').length; // wrapping only adds/drops spaces
let chatTranslate = false;
// Hidden or inert when the bridge PC lacks the engine (no FunASR/ffmpeg, Ollama or model missing).
let chatFeatures: ChatFeatures = { transcribe: true, translate: true };
let orcaAvailable = true;
const translating = () => chatTranslate && chatFeatures.translate;
function applyCapabilities(capabilities: { chatFeatures?: ChatFeatures; imageRead?: boolean; orca?: boolean } | null) {
  imageReadOffered = capabilities?.imageRead !== false;
  if (capabilities) orcaAvailable = capabilities.orca !== false;
  const next = capabilities?.chatFeatures;
  if (!next) return;
  const changed = next.transcribe !== chatFeatures.transcribe || next.translate !== chatFeatures.translate;
  chatFeatures = { transcribe: next.transcribe === true, translate: next.translate === true };
  if (changed) phone?.render();
}
let chatTranslateWrites = Promise.resolve();

function readerLayout(s: TextScreen) {
  if (s.pageText === s.text && s.pages && s.pagesFine === s.fine) return s.pages;
  s.pagesFine = s.fine;
  const chatScreen = s.reader instanceof ChatReader;
  const font = s.fine;
  const transform = font && !chatScreen ? (text: string) => alignMarkdownTables(text, font) : (text: string) => text;
  let paginate: (text: string, startLine?: number) => ReaderPage[];
  if (s.fine) {
    // Monospace small text wraps by cells, with no native byte limit.
    const { textWidth, rows } = fineLayout(s.fine);
    const measure = fineMeasure(s.fine);
    paginate = (text, startLine) => readerPages(text, measure, textWidth, rows, Infinity, startLine);
  } else {
    const ctx = document.createElement?.('canvas').getContext('2d');
    if (ctx) ctx.font = '21px Arial';
    // Wrap with the measured firmware font; Arial only sizes non-ASCII glyphs.
    const measure = (text: string) => glassTextWidth(text, ch => ctx ? ctx.measureText(ch).width : 21);
    paginate = (text, startLine) => readerPages(text, measure, READER_WRAP_WIDTH, READER_ROWS, undefined, startLine);
  }
  if (s.openingOffset !== undefined) {
    const start = s.openingOffset;
    const before = start ? paginate(transform(s.text.slice(0, start - (chatScreen ? 1 : 2)))) : [];
    const startLine = chatScreen && start ? s.text.slice(0, start).split('\n').length - 1 : 0;
    s.pages = [...before, ...paginate(transform(s.text.slice(start)), startLine)];
    s.responsePage = before.length;
  } else {
    // Start the latest response on a fresh page if it spans more than the last page.
    const text = transform(s.text);
    const start = latestResponseStart(text);
    const whole = paginate(text);
    if (start < 0) {
      s.pages = whole;
      s.responsePage = undefined;
    } else if (readerChars(text.slice(0, start)) >= whole.slice(0, -1).reduce((count, page) => count + readerChars(page.text), 0)) {
      s.pages = whole;
      s.responsePage = whole.length - 1;
    } else {
      const before = start > 0 ? paginate(text.slice(0, start - 1)) : [];
      s.pages = [...before, ...paginate(text.slice(start))];
      s.responsePage = before.length;
    }
  }
  s.pageText = s.text;
  return s.pages;
}

function bodyText(s: TextScreen) {
  if (!s.reader) {
    const sections = textSections(s.text);
    s.offset = Math.max(0, Math.min(s.offset ?? (s.tail ? sections.length - 1 : 0), sections.length - 1));
    return sections[s.offset];
  }
  const sections = readerLayout(s);
  // Opening a session shows the top of the latest response once; later live
  // updates and refreshes follow the newest page.
  const tail = s.openAtResponse && s.responsePage !== undefined ? s.responsePage : sections.length - 1;
  s.openAtResponse = false;
  s.offset = Math.max(0, Math.min(s.offset ?? (s.tail ? tail : 0), sections.length - 1));
  return sections[s.offset].text;
}

// Full-screen voice page: nine scrollable transcript rows, a divider and one
// instruction row. Live captions show their latest words; review shows the start.
function voiceBodyText(s: TextScreen) {
  return (s.voiceTail ? tailBytes(s.text, 900) : clipBytes(s.text, 900)) || ' ';
}
function voicePage(s: TextScreen, content: string) {
  return { containerTotalNum: 4, textObject: [
    new TextContainerProperty({ ...VOICE_BODY, content, textColor: textBrightness(), paddingLength: 0, isEventCapture: 1, zOrderIndex: 1 }),
    new TextContainerProperty({ ...VOICE_HINT, content: s.voiceHint || ' ', textColor: textBrightness(), paddingLength: 0, isEventCapture: 0, zOrderIndex: 3 }),
    new TextContainerProperty({ ...VOICE_FRAME, content: ' ', textColor: textBrightness(), borderWidth: 1, borderColor: inkLevel, borderRadius: 0, isEventCapture: 0, zOrderIndex: 0 }),
    new TextContainerProperty({ ...VOICE_DIVIDER, content: ' ', textColor: textBrightness(), borderWidth: 1, borderColor: inkLevel, isEventCapture: 0, zOrderIndex: 2 }),
  ] };
}

// The reader keeps its head container (stable IDs/layers) but leaves it blank.
function screenTitle(s: Screen) { return s.kind === 'text' && s.reader ? ' ' : s.title; }

// Left part of the status row: '/Waiting Opus5.5'. A working label starts with
// its spinner glyph, drawn as a separate 20px image, so four spaces replace it.
// The model comes first so it never moves while the working words rotate:
// 'Opus5.5 /Waiting', 'Opus5.5 [spinner] Thinking...'. The Braille spinner is a
// 20px image placed after the model name, so four spaces stand in for it.
function statusLeft(label: string, model?: string) {
  const prefix = model ? `${model} ` : '';
  return label[0] !== '/' && label.length > 2 ? `${prefix}    ${label.slice(2)}` : prefix + label;
}
const readerStatusLeft = (s: TextScreen, label = s.activityLabel!) => s.reader?.coding ? statusLeft(label, s.model) : label;
// A note in the status row (Find, Sent, Starred): two blank cells first, because a Coding reader
// draws the first character as its activity icon and drops two characters (G2 1.0.82: "nd" for "Find").
const statusNote = (text: string) => `  ${text}`;
const statusIconX = (model?: string) => VOICE.xPosition + (model ? glassWidth(`${model} `) : 0);

// Right part: '[Tap&hold] Pg77/78', right-aligned in its own layer on the same
// row. Reserve the widest left text this state can show (working words rotate)
// and shrink the hint so the two parts never collide.
function readerHint(s: TextScreen, seconds: number | null | undefined) {
  bodyText(s);
  const page = s.refreshing ? tr('refreshing') : tr('pageCounter', s.offset! + 1, s.pages!.length);
  if (!s.reader?.coding) return nativeRight(s.reader?.hold
    ? statusRight(null, false, page, text => glassWidth(text) <= HINT.width - 6) : page, HINT.width);
  const left = s.activityState === 'working'
    ? Math.max(...workingLabels().map(word => glassWidth(statusLeft(`. ${word}...`, s.model))))
    : glassWidth(statusLeft(s.activityLabel || readerStatus('unknown'), s.model));
  const room = Math.min(VOICE.width - 6 - left - 10, HINT.width - 6);
  return nativeRight(statusRight(seconds, !!s.choiceMenu, page, text => glassWidth(text) <= room, !!s.reader.coding.readOnly), HINT.width);
}

function flipReader(s: TextScreen, delta: number) {
  const pages = readerLayout(s);
  // Swiping down past the last page resumes live updates and fetches now.
  if (delta > 0 && !s.pageWriting && (s.offset ?? 0) >= pages.length - 1) {
    if (s.reader?.coding || s.reader?.refreshOnEnd) void refreshReader(s);
    return;
  }
  s.reading = true; // Freeze this snapshot and its page count while browsing.
  s.pageTarget = Math.max(0, Math.min(pages.length - 1, (s.pageTarget ?? s.offset ?? 0) + delta));
  if (s.pageWriting) return;
  s.pageWriting = true;
  const write = readerWrites.then(async () => {
    while (current === s && s.pageTarget !== s.offset) {
      const target = s.pageTarget = Math.min(s.pageTarget!, readerLayout(s).length - 1);
      if (target === s.offset) break;
      const next = { ...s, offset: target };
      const content = bodyText(next);
      if (s.fine) { if (!await paintFine(s, target)) return; }
      else if (!await bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: BODY.containerID, containerName: BODY.containerName, content }))) throw new Error(tr('pageRejected'));
      if (current !== s) return;
      s.offset = target;
      await inputHint();
      if (current !== s) return;
    }
  });
  readerWrites = write.catch(e => diag((e as Error).message)).finally(() => { s.pageWriting = false; s.pageTarget = undefined; });
}

// Unfreeze a browsed snapshot, show Refreshing… in the counter row, run one poll
// immediately, then restore the counter. Polling continues live afterwards.
async function refreshReader(s: TextScreen) {
  if (s.refreshing || current !== s) return;
  s.refreshing = true;
  s.reading = false;
  s.tail = true;
  try {
    await inputHint();
    if (current !== s) return;
    if (s.reader?.coding) await startReaderUpdates(s)?.();
    else if (s.reader?.refreshOnEnd) {
      const loaded = await s.reader.load();
      if (current === s) {
        if (loaded.text !== s.text || s.reader instanceof ChatReader) await updateText(s.title, loaded.text, loaded.openingOffset);
        if (s.reader instanceof ChatReader) void translateChat(s, s.reader);
      }
    }
  } catch (e) { diag((e as Error).message); }
  finally {
    s.refreshing = false;
    if (current === s) await inputHint().catch(e => diag((e as Error).message));
  }
}

function activityLabel(state: string) {
  return readerStatus(state);
}

// Reader status (left part of the status row). Writes are serialized with the
// hint so the two layers of the row never interleave.
function writePanel(label: string, active: () => boolean = () => true) {
  const owner = current;
  const write = panelWrites.then(async () => {
    if (!active() || owner?.kind !== 'text' || !owner.reader) return false;
    if (owner.fine) { owner.fineLabel = label; requestFineStatus(owner); return true; }
    let visible = readerStatusLeft(owner, label);
    if (owner.reader.coding) {
      try {
        await bridge.updateImageRawData(new ImageRawDataUpdate({ containerID: STATUS_ICON.containerID, containerName: STATUS_ICON.containerName,
          imageData: statusPixels(label[0] !== '/' ? label[0] : '', inkByte(inkLevel)) }));
      } catch (e) {
        // A missing image renderer must not prevent the status text.
        diag((e as Error).message);
        visible = owner.model ? `${owner.model} ${label}` : label;
      }
    }
    if (!active()) return false;
    return bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: VOICE.containerID, containerName: VOICE.containerName, content: visible || ' ', textColor: textBrightness() }));
  });
  panelWrites = write.then(() => {}, () => {});
  return write;
}

async function inputHint() {
  const owner = current;
  if (owner?.kind !== 'text' || !owner.reader) return;
  if (owner.fine) { requestFineStatus(owner); return; }
  const write = panelWrites.then(async () => {
    if (current !== owner) return;
    await bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: HINT.containerID, containerName: HINT.containerName,
      content: readerHint(owner, owner.reportedSeconds), textColor: textBrightness() }));
  });
  panelWrites = write.then(() => {}, () => {});
  await write;
}

async function show(s: Screen, reloadText = false) {
  clearInterval(poll);
  clearInterval(statusAnimation);
  clearInterval(menuAnimation);
  clearInterval(menuPoll);
  if (s.kind === 'text' && s.reader) s.activityLabel = s.reader.statusText?.() ?? s.activityLabel ?? readerStatus('unknown');
  if (s.kind === 'text' && s.reader && !s.voice) {
    if (s.reader instanceof ChatReader) Object.assign(s, s.reader.content());
    s.fine = readerText === 'native' ? undefined : readerText;
    s.tiles = undefined; // A rebuild clears every image container.
    s.menuActions = readerMenu(s);
  }
  const previous = current;
  current = s;
  const content = s.kind === 'text' ? (s.voice ? voiceBodyText(s) : bodyText(s)) : '';
  const fine = s.kind === 'text' && !!s.fine && (!!s.reader || !!s.comparison || !!s.imageView || !!s.keysPage || !!s.usagePage);
  const uploadText = !fine && (reloadText || (s.kind === 'text' && !!s.reader && s.text.length > 900) || new TextEncoder().encode(content).length > 999);
  const head = new TextContainerProperty({ ...HEAD, ...(s.kind === 'text' && s.reader ? { xPosition: 16, yPosition: 2, width: 544, height: 28, zOrderIndex: 1 } : {}), content: clipBytes(screenTitle(s), TEXT_BYTES), isEventCapture: 0 });
  // Firmware retains Display off, Brightness and Close alongside these actions.
  const menu = s.menuActions ? { menuObject: new MenuContainerProperty({
    menuItems: s.menuActions!.map(action => new MenuItemProperty({ itemID: action.id, itemName: action.label })),
  }) } : {};
  let page =
    s.kind === 'list'
      ? {
          containerTotalNum: s.module ? 6 : 2,
          ...menu,
          textObject: s.module ? [
            new TextContainerProperty({ ...HEAD, ...MENU_HEAD, content: moduleHeading(moduleLabel(activeModule)), isEventCapture: 0, paddingLength: 0, zOrderIndex: 1 }),
            new TextContainerProperty({ ...MENU_COUNT, content: nativeRight(s.count ?? '', MENU_COUNT.width), isEventCapture: 0, paddingLength: 0, zOrderIndex: 2 }),
            new TextContainerProperty({ containerID: 5, containerName: 'menu-input', xPosition: 0, yPosition: 0, width: 576, height: 288, content: ' ', isEventCapture: 1, paddingLength: 0, zOrderIndex: 0 }),
            new TextContainerProperty({ ...MENU_CURSOR, content: menuCursorText(s.columns!, s.selected || 0), isEventCapture: 0, paddingLength: 0, zOrderIndex: 3 }),
            new TextContainerProperty({ ...MENU_LEFT, content: menuNativeText(s.columns!), isEventCapture: 0, paddingLength: 0, zOrderIndex: 4 }),
            new TextContainerProperty({ containerID: 6, containerName: 'menu-right', ...MENU_RIGHT, yPosition: 28, height: 260, content: s.columns!.map(r => nativeRight(r.right, MENU_RIGHT.width)).join('\n'), isEventCapture: 0, paddingLength: 0, zOrderIndex: 5 }),
          ] : [head],
          ...(s.module ? {} : { listObject: [
            new ListContainerProperty({
              ...BODY,
              isEventCapture: 1,
              itemContainer: new ListItemContainerProperty({
                itemCount: Math.min(s.items.length, LIST_MAX),
                itemName: s.items.slice(0, LIST_MAX).map((t) => clipBytes(t, LIST_ITEM_BYTES)),
              }),
            }),
          ] }),
        }
      : {
          containerTotalNum: s.reader ? 7 : 2,
          ...menu,
          textObject: [head, new TextContainerProperty({ ...BODY, ...(s.reader ? { xPosition: 8, yPosition: READER_TOP, width: 560, paddingLength: 0, zOrderIndex: 2, height: READER_HEIGHT, textColor: textBrightness() } : {}), content: uploadText ? '' : content, isEventCapture: 1 }),
            ...(s.reader ? [
              new TextContainerProperty({ ...HINT, content: readerHint(s, s.reportedSeconds), textColor: textBrightness(), isEventCapture: 0, paddingLength: 0, zOrderIndex: 6 }),
              new TextContainerProperty({ ...VOICE, content: readerStatusLeft(s), textColor: textBrightness(), isEventCapture: 0, paddingLength: 0, zOrderIndex: 5 }),
              new TextContainerProperty({ ...FRAME, content: ' ', textColor: textBrightness(), borderWidth: 1, borderColor: inkLevel, borderRadius: 0, isEventCapture: 0, zOrderIndex: 0 }),
              new TextContainerProperty({ ...DIVIDER, content: ' ', textColor: textBrightness(), borderWidth: 1, borderColor: inkLevel, isEventCapture: 0, zOrderIndex: 3 }),
            ] : [])],
          ...(s.reader ? { imageObject: [new ImageContainerProperty({ ...STATUS_ICON, xPosition: statusIconX(s.model), zOrderIndex: 4 })] } : {}),
        };
  if (fine) page = { containerTotalNum: s.kind === 'text' && s.comparison === 'fonts' ? 6 : 5, ...menu,
    textObject: [new TextContainerProperty({ ...FINE_CAPTURE, content: ' ', isEventCapture: 1, paddingLength: 0, zOrderIndex: 0 }),
      // Compare fonts: Native text in its own container above the tiles. Not the swipe-capturing
      // container: the glasses scroll that one's text on every swipe (G2, 1.0.81).
      ...(s.kind === 'text' && s.comparison === 'fonts' ? [new TextContainerProperty({ ...FINE_NATIVE_ROW, content: nativeCompareRow(s),
        textColor: textBrightness(), isEventCapture: 0, paddingLength: 0, zOrderIndex: 5 })] : [])],
    imageObject: FINE_TILE_IDS.map((tile, i) => new ImageContainerProperty({ ...tile, zOrderIndex: i + 1 })),
  } as unknown as typeof page;
  if (s.kind === 'text' && s.voice) page = voicePage(s, content) as typeof page;
  try {
    if (!started) {
      // Bootstrap with the small, hardware-proven native text shape. The richer
      // menu is a later rebuild, so rejection cannot consume startup itself.
      started = true;
      const bootstrap = { containerTotalNum: 2, textObject: [
        new TextContainerProperty({ ...HEAD, content: sessionHeading(), isEventCapture: 0 }),
        new TextContainerProperty({ ...BODY, content: tr('connectingOrca'), isEventCapture: 1 }),
      ] };
      const result = await bridge.createStartUpPageContainer(new CreateStartUpPageContainer(bootstrap));
      if (result !== 0 && !await bridge.rebuildPageContainer(new RebuildPageContainer(bootstrap))) {
        throw new Error(`${sessionHeading()}: native startup failed (${result}); bootstrap recovery rejected.`);
      }
    }
    if (s.kind === 'list' && s.module && compactMenuOnly) {
      s.compat = true; page = compatibilityMenu(s, menu) as typeof page;
    }
    if (s.kind === 'list' && (s.workspacePicker || s.agentPicker || s.textPicker)) { s.compat = true; page = compatibilityMenu(s, {}) as typeof page; }
    let accepted = await rebuildPage(page);
    const aligned = s.kind === 'list' && !!s.module && !s.compat;
    // A rejected aligned menu is tried once more before the compact one.
    if (!accepted && aligned) accepted = await rebuildPage(page);
    if (aligned && accepted) alignedRejections = 0;
    if (!accepted && aligned && s.kind === 'list') {
      alignedRejections++;
      s.compat = true;
      accepted = await rebuildPage(compatibilityMenu(s, menu));
      if (accepted && alignedRejections >= COMPACT_AFTER) { compactMenuOnly = true; diag(`${sessionHeading()}: aligned layout rejected ${alignedRejections} times; compact compatibility menu active.`); }
      else if (accepted) diag(`${sessionHeading()}: aligned layout rejected (${alignedRejections}/${COMPACT_AFTER}); compact menu for this screen only.`);
    }
    if (!accepted) throw new Error(`${sessionHeading()}: ${s.kind === 'list' && s.module ? 'both aligned and compact menus rejected' : tr('screenRejected')}.`);
    if (s.kind === 'list' && s.module) document.getElementById('menu-layout')!.textContent = s.compat
      ? tr('menuLayoutCompact') : tr('menuLayoutAligned');
    if (uploadText && s.kind === 'text') {
      const accepted = await bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: BODY.containerID, containerName: BODY.containerName, content }));
      if (!accepted) throw new Error(tr('textLoadFailed'));
    }
    if (s.kind === 'list' && s.module === 'coding' && !s.compat) startMenuSpinner(s);
    else if (s.kind === 'list' && s.module) syncLoadingDots(s);
    if (s.kind === 'text') {
      if (fine && !s.voice) await paintFine(s, s.offset ?? 0);
      else if (s.reader?.coding) await bridge.updateImageRawData(new ImageRawDataUpdate({ containerID: STATUS_ICON.containerID, containerName: STATUS_ICON.containerName, imageData: statusPixels(s.activityLabel![0] === '/' ? '' : s.activityLabel![0], inkByte(inkLevel)) })).catch(e => diag((e as Error).message));
      if (s.reader) startReaderUpdates(s);
    }
  } catch (e) {
    if (current === s) current = previous;
    diag((e as Error).message);
    throw e;
  }
}

// Draw a small-text page and upload only the tiles that changed. Returns false
// when the screen changed meanwhile; throws if the glasses reject a tile.
async function paintFine(s: TextScreen, page: number, snapshot = s): Promise<boolean> {
  const t0 = Date.now();
  const tiles = s.keysPage ? renderKeysPage(tr('keysAll').split('\n'), s.fine!, inkLevel)
    : s.usagePage ? renderUsagePage(s.usagePage, s.fine!, inkLevel)
    : s.imageView ? imageViewTiles(s.imageView)
    : s.comparison === 'fonts' ? renderFontComparison(inkLevel, (s.compareSelected ?? 0) - 1, true)
    : s.comparison === 'backgrounds' ? renderBackgroundComparison(s.fine!, inkLevel, turnHalo, s.compareSelected)
    : renderFineScreen(readerLayout(snapshot)[page], s.fine!, fineStatus(snapshot, page), inkLevel, backgroundFor(snapshot), turnHalo);
  let sent = 0;
  for (let i = 0; i < tiles.length; i++) {
    if (current !== s) return false;
    const before = s.tiles?.[i];
    if (before && before.length === tiles[i].length && before.every((v, p) => v === tiles[i][p])) continue;
    const tile = FINE_TILE_IDS[i];
    const result = await bridge.updateImageRawData(new ImageRawDataUpdate({ containerID: tile.containerID, containerName: tile.containerName, imageData: tiles[i] }));
    if (result !== ImageRawDataUpdateResult.success) throw new Error(`Glasses rejected small-text tile ${i + 1} (${result}).`);
    (s.tiles ??= [])[i] = tiles[i];
    sent++;
  }
  diag(`Small text (${s.fine}): ${sent} tile(s) in ${Date.now() - t0} ms`);
  return current === s;
}

// Status row drawn in the small font: '⠋ Thinking... Opus5.5' left, '13m
// [Tap&Hold for Input] Pg3/5' right. The timer shows whole minutes so the row
// changes (and is re-sent) at most once a minute while idle text stays put.
function fineStatus(s: TextScreen, page: number): FineStatus {
  const label = s.fineLabel ?? s.activityLabel ?? readerStatus('unknown');
  if (!s.reader?.coding) {
    const where = s.refreshing ? tr('refreshing') : tr('pageCounter', page + 1, readerLayout(s).length);
    const room = fineLayout(s.fine!).columns - fineCells(label) - 1;
    return { left: label, right: s.reader?.hold ? statusRight(null, false, where, text => fineCells(text) <= room) : where };
  }
  // Working labels start with a Braille spinner frame; tile modes draw the
  // scanner sweep in its place, stepping with the same frame counter.
  const working = label[0] !== '/' && label.length > 2;
  const words = working ? label.slice(2) : label;
  const scannerCells = working ? Math.ceil(SCANNER_WIDTH / fineLayout(s.fine!).cell) + 1 : 0;
  const leftCells = (s.model ? fineCells(s.model) + 1 : 0) + scannerCells + fineCells(words);
  const pages = readerLayout(s).length;
  const where = s.refreshing ? tr('refreshing') : tr('pageCounter', page + 1, pages);
  const minutes = s.activityState === 'working' && s.reportedSeconds != null ? `${Math.floor(s.reportedSeconds / 60)}m` : '';
  const room = fineLayout(s.fine!).columns - leftCells - 1;
  const right = [minutes, statusRight(null, !!s.choiceMenu, where, text => fineCells([minutes, text].filter(Boolean).join(' ')) <= room, !!s.reader.coding.readOnly)].filter(Boolean).join(' ');
  return working ? { model: s.model, scanner: s.statusFrame || 0, left: words, right }
    : { left: s.model ? `${s.model} ${label}` : label, right };
}

// Coalesced repaint of the current small-text page on status changes.
// Serialized with page turns on the reader write queue; only
// tiles whose pixels changed are sent, usually the bottom two.
function requestFineStatus(s: TextScreen) {
  if (s.fineQueued) return;
  s.fineQueued = true;
  const run = readerWrites.then(async () => {
    s.fineQueued = false;
    if (current !== s || !s.fine || s.pageWriting) return;
    await paintFine(s, s.offset ?? 0);
  });
  readerWrites = run.catch(e => diag((e as Error).message));
}

// Reader long-press menu. The Font list includes the Backgrounds menu and the font comparison;
// a chat reader adds Translate.
function readerMenu(screen: TextScreen) {
  const name = readerText === 'native' ? tr('nativeText') : fineLabel(readerText);
  return [
    // Straight into the comparison pages, where the choice is made (Eugene, 2026-11-27).
    // `up` is set when Ctrl+, or Ctrl+Shift+P opened the page: going back returns to that menu.
    { id: 1101, label: tr('usingFont', name), run: (up?: Up) => openComparison(screen, 'fonts', up) },
    { id: 1109, label: tr('background', turnBackgroundLabel(turnBackground)), run: (up?: Up) => openComparison(screen, 'backgrounds', up) },
    { id: 1107, label: tr('brightness', inkLevel), run: (up?: Up) => showBrightness(screen, up) },
    ...(screen.reader instanceof ChatReader && chatFeatures.translate
      ? [{ id: 1108, label: tr(chatTranslate ? 'chatTranslateEnglish' : 'chatTranslateOff'), run: () => setChatTranslation(!chatTranslate) }]
      : []),
  ];
}

// Ten native rows, no title and no blank row between entries. A swipe past the
// last row opens the next page; a swipe past the first opens the previous one.
// Both lists wrap: past the first row lands on the last, and the reverse.
const TEXT_PICKER_ROWS = 10;
function showTextPicker(reader: TextScreen, labels: string[], selected: number, onPick: (i: number) => unknown, wrap = false, up?: Up) {
  const pageCount = Math.max(1, Math.ceil(labels.length / TEXT_PICKER_ROWS));
  const open = (page: number, cursor: number): Promise<void> => {
    const start = page * TEXT_PICKER_ROWS;
    const items = labels.slice(start, start + TEXT_PICKER_ROWS);
    const at = cursor < 0 ? items.length - 1 : Math.max(0, Math.min(cursor, items.length - 1));
    return show({
      kind: 'list', textPicker: true, title: ' ', items, selected: at, paintedSelection: at,
      onPreviousPage: page > 0 ? () => open(page - 1, -1) : wrap ? () => open(pageCount - 1, -1) : undefined,
      onNextPage: page + 1 < pageCount ? () => open(page + 1, 0) : wrap ? () => open(0, 0) : undefined,
      onPick: i => onPick(start + i),
      onBack: () => up ? up() : show(reader),
    });
  };
  const at = Math.max(0, Math.min(selected, labels.length - 1));
  return open(Math.floor(at / TEXT_PICKER_ROWS), at % TEXT_PICKER_ROWS);
}

// Steps 15 down to 1, ten per page. A swipe past either end wraps to the other.
// Click one and the reader comes back at that ink.
function showBrightness(reader: Screen | null = current, up?: Up) {
  if (reader?.kind !== 'text' || !reader.reader) return;
  const levels = Array.from({ length: 15 }, (_, i) => 15 - i);
  const at = Math.max(0, levels.indexOf(inkLevel));
  return showTextPicker(reader, levels.map(n => n === inkLevel ? `${n} ✓` : String(n)), at, async i => {
    inkLevel = levels[i];
    await bridge.setLocalStorage('reader-ink', String(inkLevel));
    await show(reader);
  }, true, up);
}

// Both comparisons use the reader's tiles and return to the same page on a swipe.
// Choose on the comparison page itself (Eugene, 2026-11-27): a swipe moves the '>' (wrapping),
// a click uses the marked font or background and returns to the reader, a double-click returns
// unchanged (to the Ctrl+, or Ctrl+Shift+P menu when one opened the page). Opens on the current choice.
function openComparison(reader: TextScreen, comparison: Comparison, up?: Up) {
  const back = () => { void Promise.resolve(up ? up() : show(reader)).catch(e => diag((e as Error).message)); };
  const fonts = comparison === 'fonts';
  // Compare fonts: row 0 is Native text, then the pixel fonts largest first. Compare backgrounds:
  // row 0 is the Halo switch, then the options.
  const compareSelected = fonts ? (readerText === 'native' ? 0 : FONTS_BY_SIZE.indexOf(readerText) + 1)
    : Math.max(0, TURN_BACKGROUNDS.indexOf(turnBackground)) + 1;
  const screen: TextScreen = { kind: 'text', title: ' ', text: '', fine: reader.fine ?? smallFont, comparison, compareSelected, onBack: back };
  let choosing = false;
  screen.onClick = () => {
    if (choosing || current !== screen) return;
    choosing = true;
    const i = screen.compareSelected ?? 0;
    const pick = fonts ? setReaderText(i === 0 ? 'native' : FONTS_BY_SIZE[i - 1], reader)
      : i === 0 ? toggleHalo(screen) : chooseBackground(TURN_BACKGROUNDS[i - 1], reader);
    void pick.catch(e => diag((e as Error).message)).finally(() => { choosing = false; });
  };
  return show(screen);
}

function moveComparison(s: TextScreen, step: number) {
  const count = (s.comparison === 'fonts' ? FINE_FONTS.length : TURN_BACKGROUNDS.length) + 1;
  const before = s.compareSelected ?? 0;
  s.compareSelected = (before + step + count) % count;
  // Only the tiles whose rows changed are sent again; the Native row's '>' is in its text container.
  readerWrites = readerWrites.then(async () => {
    if (current !== s) return;
    if (s.comparison === 'fonts' && (before === 0) !== (s.compareSelected === 0)) {
      await bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: FINE_NATIVE_ROW.containerID, containerName: FINE_NATIVE_ROW.containerName, content: nativeCompareRow(s) }));
    }
    await paintFine(s, 0);
  }).catch(e => diag((e as Error).message));
}

// The Native text row of Compare fonts, in the glasses' own font: its label and the sample.
function nativeCompareRow(s: TextScreen) {
  return `${s.compareSelected === 0 ? '>' : ' '}${tr('nativeText')}  ${fontSample()}`;
}

// ---- Images (2026-11-27): [Image N], [Photo N], [Sticker N] rows open full screen ----
// A click on a reader page opens the first picture on that page; a swipe goes to the next or
// previous picture of the conversation, a click shows it in negative, a double-click returns.
function imageViewTiles(view: ImageView): number[][] {
  const position = view.count > 1 ? ` · ${view.numbers.indexOf(view.n) + 1}/${view.count}` : '';
  const label = tr(IMAGE_VIEW_LABEL[view.mode]);
  if (view.mode === 'read' && view.text !== undefined && !view.note) {
    // The local AI's reading, in the pixel font, a page at a time: no divider, and "AI Readout 1/2"
    // in the same bottom-right caption box as a picture's.
    const { textWidth, rows } = fineLayout(smallFont);
    const pages = readerPages(view.text, fineMeasure(smallFont), textWidth, rows, Infinity);
    const page = pages[Math.min(view.textPage, pages.length - 1)];
    return captionTiles(renderTextPage(page, smallFont, inkLevel), `${label} ${Math.min(view.textPage, pages.length - 1) + 1}/${pages.length}`, smallFont, inkLevel);
  }
  if (!view.image || view.note) return captionTiles(renderTextPage({ text: view.note || tr('imageLoading', view.numbers.indexOf(view.n) + 1, view.count),
    userTurns: [], firstLine: 0, lastLine: 0 }, smallFont, inkLevel), `${label}${position}`, smallFont, inkLevel);
  const bytes = Uint8Array.from(atob(view.image.data), ch => ch.charCodeAt(0));
  const top = inkByte(inkLevel);
  // The bridge draws the negative itself (before finding the edges); bridges before 1.0.84 send
  // no `negative` field, and there the app still inverts a mostly white picture.
  const invert = view.mode !== 'outline' && view.image.negative === undefined && (view.invert ?? view.image.mean > 0.6);
  const tiles = FINE_TILES.map(tile => {
    const out = new Array<number>(tile.width * tile.height);
    for (let y = 0; y < tile.height; y++) for (let x = 0; x < tile.width; x++) {
      const i = (tile.yPosition + y) * 576 + tile.xPosition + x;
      const packed = bytes[i >> 1] ?? 0;
      let level = i & 1 ? packed & 15 : packed >> 4;
      if (invert) level = 15 - level;
      out[y * tile.width + x] = Math.round(level * top / 15);
    }
    return out;
  });
  const section = view.mode === 'zoom' && view.regions > 1 ? ` ${view.region + 1}/${view.regions}` : '';
  return captionTiles(tiles, `${label}${section}${position}`, smallFont, inkLevel);
}

function pageImage(s: TextScreen): number | undefined {
  if (!s.reader?.image) return undefined;
  const page = readerLayout(s)[s.offset ?? 0];
  return page ? imageNumbers(page.text)[0] : undefined;
}

// Picture viewer (Eugene, 2026-11-27, after looking at charts on G2): a click cycles Picture
// (whole, auto negative), Zoom (sections; swipe moves through them), Outline (edges only) and Read
// (the local AI's text). Swipe: the next section, text page or picture; n: negative; double-click: back.
function openPageImage(s: Screen | null): boolean {
  if (s?.kind !== 'text' || !s.reader?.image || s.voice) return false;
  const n = pageImage(s);
  if (n === undefined) return false;
  const numbers = imageNumbers(s.text);
  const load = s.reader.image;
  const reader = s;
  reader.reading = true;
  const view: ImageView = { n, count: numbers.length, numbers, load, mode: 'fit', region: 0, regions: 1, textPage: 0, note: '' };
  const screen: TextScreen = { kind: 'text', title: ' ', text: '', fine: reader.fine ?? smallFont, imageView: view,
    onBack: () => { Object.assign(reader, { reading: false }); void show(reader).catch(e => diag((e as Error).message)); },
    onClick: () => {
      const modes = IMAGE_VIEWS.filter(mode => mode !== 'read' || imageReadOffered);
      view.mode = modes[(modes.indexOf(view.mode) + 1) % modes.length];
      Object.assign(view, { region: 0, textPage: 0, image: undefined, text: undefined, note: '' });
      void repaintImage(screen).then(() => loadImage(screen));
    } };
  void show(screen).then(() => loadImage(screen)).catch(e => diag((e as Error).message));
  return true;
}

function repaintImage(s: TextScreen) {
  readerWrites = readerWrites.then(async () => { if (current === s) await paintFine(s, 0); }).catch(e => diag((e as Error).message));
  return readerWrites;
}

async function loadImage(s: TextScreen) {
  const view = s.imageView!;
  const { n, mode, region } = view;
  if (mode === 'read') { view.note = tr('imageReading'); await repaintImage(s); view.note = ''; }
  try {
    const answer = await view.load(n, { view: mode, region, ...(view.invert !== undefined && { negative: view.invert ? 'on' : 'off' }) });
    if (current !== s || view.n !== n || view.mode !== mode || view.region !== region) return;
    if (mode === 'read') view.text = answer.text ?? '';
    else {
      view.image = answer;
      view.regions = answer.regions ?? 1;
    }
  } catch (e) {
    if (current !== s || view.n !== n || view.mode !== mode) return;
    const code = (e as Error).message;
    view.note = code === 'images-unavailable' ? tr('imageNeedsFfmpeg') : code === 'read-unavailable' ? tr('imageReadUnavailable')
      : tr('imageFailed', view.numbers.indexOf(n) + 1, view.count, code);
  }
  await repaintImage(s);
}

function moveImage(s: TextScreen, step: number) {
  const view = s.imageView!;
  // Zoom: sections first; Read: text pages first; then the next or previous picture.
  if (view.mode === 'zoom' && view.image && view.region + step >= 0 && view.region + step < view.regions) {
    view.region += step;
    view.image = undefined;
    void loadImage(s);
    return;
  }
  if (view.mode === 'read' && view.text !== undefined) {
    const { textWidth, rows } = fineLayout(smallFont);
    const pages = readerPages(view.text, fineMeasure(smallFont), textWidth, rows, Infinity).length;
    if (view.textPage + step >= 0 && view.textPage + step < pages) { view.textPage += step; void repaintImage(s); return; }
  }
  if (view.count < 2) return;
  const at = view.numbers.indexOf(view.n);
  Object.assign(view, { n: view.numbers[(at + step + view.count) % view.count], image: undefined, text: undefined,
    region: 0, regions: 1, textPage: 0, invert: undefined, note: '' });
  void repaintImage(s).then(() => loadImage(s));
}

// The Halo row of Compare backgrounds: toggles, saves and redraws the page (it stays open).
async function toggleHalo(s: TextScreen) {
  if (!await bridge.setLocalStorage(HALO_KEY, turnHalo ? 'off' : 'on')) throw new Error(tr('backgroundSaveFailed'));
  turnHalo = !turnHalo;
  await repaintImage(s);
}

async function chooseBackground(option: TurnBackground, reader: TextScreen) {
  if (!await bridge.setLocalStorage('reader-turn-bg', option)) throw new Error(tr('backgroundSaveFailed'));
  turnBackground = option;
  await show(reader);
}

// Switch fonts in place and keep the reader near the same text: the first
// character of the current page stays on screen; the newest page stays newest.
async function setReaderText(mode: ReaderText, screen: Screen | null = current) {
  await bridge.setLocalStorage('reader-text', mode);
  readerText = mode;
  if (mode !== 'native') { smallFont = mode; await bridge.setLocalStorage('reader-font', mode); }
  const s = screen;
  if (s?.kind !== 'text' || !s.reader || s.voice) return;
  const pages = readerLayout(s);
  const atEnd = (s.offset ?? 0) >= pages.length - 1;
  const before = pages.slice(0, s.offset ?? 0).reduce((count, page) => count + readerChars(page.text), 0);
  s.fine = mode === 'native' ? undefined : mode;
  const next = readerLayout(s);
  let index = 0, seen = 0;
  while (index < next.length - 1 && seen + readerChars(next[index].text) <= before) seen += readerChars(next[index++].text);
  s.offset = atEnd ? next.length - 1 : index;
  s.openAtResponse = false;
  await show(s);
}

function keepReaderLine(before: TextScreen, after: TextScreen) {
  const offset = before.offset ?? 0;
  const anchor = readerLayout(before)[offset]?.firstLine;
  if (anchor === undefined) return;
  const pages = readerLayout(after);
  const first = pages.findIndex(page => page.lastLine >= anchor);
  if (first < 0) return;
  if (offset === before.responsePage && anchor === pages[after.responsePage ?? 0].firstLine) {
    after.offset = after.responsePage;
    return;
  }
  const past = pages.findIndex(page => page.firstLine > anchor);
  after.offset = Math.max(first, Math.min(offset, past < 0 ? pages.length - 1 : past - 1));
}

async function updateText(title: string, text: string, openingOffset?: number, position: 'live' | 'page' | 'line' = 'live') {
  if (current?.kind !== 'text') return;
  const screen = current;
  const write = async () => {
    const active = () => current === screen && (position !== 'live' || !screen.reader || !screen.reading);
    if (!active()) return;
    const next = { ...screen, title, text, openingOffset: openingOffset ?? screen.openingOffset,
      ...(screen.reader instanceof ChatReader && screen.reader.content()),
    };
    if (screen.reader && position === 'live') next.offset = undefined; // Live mode follows the newest page.
    if (position === 'line') keepReaderLine(screen, next);
    const content = bodyText(next);
    if (screenTitle(next) !== screenTitle(screen)) {
      if (!await bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: HEAD.containerID, containerName: HEAD.containerName, content: clipBytes(screenTitle(next), TEXT_BYTES) }))) throw new Error('Glasses rejected the title update.');
    }
    if (!active()) return;
    if (screen.fine) { if (!await paintFine(screen, next.offset ?? 0, next)) return; }
    else if (!await bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: BODY.containerID, containerName: BODY.containerName, content }))) throw new Error('Glasses rejected the live text update. Retrying.');
    if (active()) {
      Object.assign(screen, { title, text: next.text, openingOffset: next.openingOffset, offset: next.offset,
        pages: next.pages, pageText: next.pageText, responsePage: next.responsePage,
        voiceLines: 'voiceLines' in next ? next.voiceLines : undefined });
      if (screen.reader) await inputHint();
    }
  };
  if (screen.reader) {
    const work = readerWrites.then(write);
    readerWrites = work.catch(() => {});
    await work;
  } else await write();
}

async function guard(title: string, f: () => Promise<void>, back: () => void) {
  try {
    await f();
  } catch (e) {
    await show({ kind: 'text', title, text: tr('error', (e as Error).message), onBack: back, onClick: back });
  }
}

// ---- 画面 ----


type SessionMenuScreen = Extract<Screen, { kind: 'list' }>;
type ModuleListContent = Omit<SessionMenuScreen, 'kind' | 'title' | 'module' | 'selected'>;
const moduleCache = new Map<GlassModule, { page: number; content: ModuleListContent }>();
function compatibilityMenu(screen: SessionMenuScreen, menu: object) {
  // The workspace picker has no title row: its ten 27px rows start at the top.
  const picker = !!screen.workspacePicker || !!screen.agentPicker || !!screen.textPicker; // no title row: ten rows
  return { containerTotalNum: 3, ...menu, textObject: [
    new TextContainerProperty({ ...HEAD, height: 28, content: ' ', isEventCapture: 0 }),
    new TextContainerProperty({ ...BODY, yPosition: picker ? 4 : 0, height: picker ? 280 : 288, content: compatibilityText(screen), isEventCapture: 0 }),
    new TextContainerProperty({ containerID: 3, containerName: 'menu-input', xPosition: 0, yPosition: 0,
      width: 576, height: 288, content: ' ', isEventCapture: 1 }),
  ] };
}
function compatibilityText(screen: SessionMenuScreen, selected = screen.selected || 0) {
  // Section headings sit flush left without a cursor column.
  return screen.items.map((item, i) => {
    if (screen.module && i === 0) {
      const left = `${i === selected ? '>' : ' '} ${moduleHeading(moduleLabel(activeModule))}`;
      return left + nativeRight(screen.count ?? '', 576 - glassWidth(left));
    }
    return screen.headings?.includes(i) ? clipBytes(item, 48) : `${i === selected ? '>' : ' '} ${clipBytes(item, 48)}`;
  }).join('\n');
}
// Email loading rows (Eugene, 2026-11-27: "show a animated loading screen ... so ppl know it's
// working"): the same dot that moves in the gutter of a busy Coding session, 500 ms a step.
function syncLoadingDots(screen: SessionMenuScreen) {
  clearInterval(menuAnimation);
  menuAnimation = undefined;
  if (screen.compat || !screen.columns?.some(row => row.busy)) return;
  screen.menuFrame ??= 0;
  menuAnimation = setInterval(() => {
    if (current !== screen || screen.paging) return;
    screen.menuFrame = ((screen.menuFrame || 0) + 1) % MENU_DOTS.length;
    if (!screen.cursorWriting) sessionCursorWrites = updateSessionCursor(screen);
  }, 500);
}
function startMenuSpinner(screen: SessionMenuScreen) {
  let polling = false;
  screen.menuFrame = 0;
  screen.paintedCursor = menuCursorText(screen.columns!, screen.selected || 0);
  menuAnimation = setInterval(() => {
    if (current !== screen || screen.paging) return;
    screen.menuFrame = ((screen.menuFrame || 0) + 1) % 3;
    if (!screen.cursorWriting) sessionCursorWrites = updateSessionCursor(screen);
  }, 500);
  menuPoll = setInterval(async () => {
    if (polling || current !== screen || screen.paging) return;
    polling = true;
    try {
      const latest = await api.threads();
      if (current !== screen || screen.paging) return;
      for (const row of screen.columns!) {
        if (!row.handle) continue;
        const state = latest.find(t => t.handle === row.handle)?.state || 'unknown';
        row.busy = state === 'busy'; row.marker = state === 'idle' ? '/' : state === 'busy' ? '' : '?';
      }
      if (!screen.cursorWriting) sessionCursorWrites = updateSessionCursor(screen);
    } catch (e) { diag((e as Error).message); }
    finally { polling = false; }
  }, 3000);
}
async function updateSessionCursor(screen: SessionMenuScreen) {
  if (screen.cursorWriting) return;
  screen.cursorWriting = true;
  try {
    // Coalesce rapid swipes to the newest position instead of queuing redraws.
    while (current === screen) {
      const content = screen.compat ? compatibilityText(screen) : menuCursorText(screen.columns!, screen.selected || 0, screen.menuFrame || 0);
      if (screen.compat ? screen.paintedSelection === screen.selected : screen.paintedCursor === content) break;
      const selected = screen.selected || 0;
      const accepted = await bridge.textContainerUpgrade(new TextContainerUpgrade(screen.compat
        ? { containerID: BODY.containerID, containerName: BODY.containerName, content: compatibilityText(screen, selected) }
        : { containerID: MENU_CURSOR.containerID, containerName: MENU_CURSOR.containerName, content }));
      if (!accepted) throw new Error('Session menu text update rejected');
      screen.paintedSelection = selected;
      screen.paintedCursor = content;
    }
  } catch (e) { diag((e as Error).message); }
  finally { screen.cursorWriting = false; }
}

function cancelModuleSwitch() {
  if (moduleTimer !== undefined) clearTimeout(moduleTimer);
  moduleTimer = undefined;
  modulePending = false;
  moduleRevision++;
}

function showModule(mounted?: SessionMenuScreen) {
  if (activeModule === 'chat') return chatHome(undefined, undefined, mounted);
  if (activeModule === 'email') return mailHome(undefined, undefined, mounted);
  return home(undefined, undefined, mounted);
}

function selectModule(next: GlassModule) {
  cancelModuleSwitch();
  activeModule = next;
  modulePending = true;
  moduleStorageWrites = moduleStorageWrites.then(async () => { await bridge.setLocalStorage('module', next); }).catch(e => diag((e as Error).message));
  phone?.render();
  return moduleRevision;
}

function paintModuleHeading(screen: SessionMenuScreen, revision: number) {
  sessionCursorWrites = sessionCursorWrites.then(async () => {
    if (current !== screen || revision !== moduleRevision) return;
    const container = screen.compat ? BODY : HEAD;
    await bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: container.containerID, containerName: container.containerName,
      content: screen.compat ? compatibilityText(screen) : moduleHeading(moduleLabel(activeModule)) }));
  }).catch(e => diag((e as Error).message));
}

async function finishModuleSwitch(owner: Screen | null, revision: number) {
  await sessionCursorWrites;
  if (current !== owner || revision !== moduleRevision) return;
  try {
    const { page, cursor } = positions[activeModule];
    const cached = moduleCache.get(activeModule);
    if (cached?.page === page) {
      const mounted = await showModuleList(activeModule, page, cursor, cached.content);
      if (current !== mounted || revision !== moduleRevision) return;
      modulePending = false;
      await showModule(mounted);
    } else await showModule();
  } finally {
    if (revision === moduleRevision) modulePending = false;
  }
}

async function choosePhoneModule(next: GlassModule) {
  if (!modules.includes(next) || (next === activeModule && !modulePending)) return;
  cancelCapture?.();
  holding = false;
  const owner = current;
  const revision = selectModule(next);
  if (owner?.kind === 'list' && owner.module) paintModuleHeading(owner, revision);
  await finishModuleSwitch(owner, revision).catch(e => diag((e as Error).message));
}

function cycleModule(screen: SessionMenuScreen) {
  const next = nextModule(modules, activeModule);
  if (next === activeModule) return;
  const revision = selectModule(next);
  paintModuleHeading(screen, revision);
  moduleTimer = setTimeout(() => {
    moduleTimer = undefined;
    if (screen.module === activeModule && moduleCache.has(activeModule)) { modulePending = false; return; }
    void finishModuleSwitch(screen, revision).catch(e => diag((e as Error).message));
  }, 400);
}

async function showModuleList(module: GlassModule, page: number, selected: number, screen: ModuleListContent, mounted?: SessionMenuScreen) {
  const items = [moduleButton(moduleLabel(module)), ...screen.items];
  const index = mounted?.selected ?? selected;
  const cursor = index < 0 ? items.length - 1 : Math.min(index, items.length - 1);
  const list: SessionMenuScreen = { ...screen, kind: 'list', title: sessionHeading(), module, items, selected: cursor, paintedSelection: cursor,
    onPick: (i) => { if (i === 0) cycleModule(list); else if (!modulePending) screen.onPick(i - 1); } };
  positions[module] = { page, cursor };
  if (!mounted) visit({ key: `list:${module}`, label: moduleLabel(module), module, open: () => showModule() }, false);
  if (screen.count !== undefined) moduleCache.set(module, { page, content: screen });
  if (mounted) { await refreshModuleRows(mounted, list, screen.onPick); return mounted; }
  await show(list);
  return list;
}

function refreshModuleRows(mounted: SessionMenuScreen, fresh: SessionMenuScreen, pick: ModuleListContent['onPick']) {
  const revision = moduleRevision;
  const write = sessionCursorWrites.then(async () => {
    if (current !== mounted || revision !== moduleRevision || mounted.paging) return;
    const cursor = Math.min(mounted.selected ?? 0, fresh.items.length - 1);
    const before = moduleRowText(mounted);
    const after = moduleRowText({ ...fresh, selected: cursor, compat: mounted.compat, menuFrame: mounted.menuFrame });
    mounted.paging = true;
    try {
      for (const [containerID, containerName, content] of after) {
        if (current !== mounted || revision !== moduleRevision) return;
        if (before.find(row => row[0] === containerID)?.[2] === content) continue;
        if (!await bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID, containerName, content }))) throw new Error(tr('screenRejected'));
      }
      if (current !== mounted || revision !== moduleRevision) return;
      Object.assign(mounted, { ...fresh, selected: cursor, paintedSelection: cursor, compat: mounted.compat, menuFrame: mounted.menuFrame,
        paintedCursor: menuCursorText(fresh.columns!, cursor, mounted.menuFrame),
        onPick: (i: number) => { if (i === 0) cycleModule(mounted); else if (!modulePending) pick(i - 1); } });
      positions[mounted.module!].cursor = cursor;
      if (mounted.module !== 'coding') syncLoadingDots(mounted);
    } catch (error) {
      if (current !== mounted || revision !== moduleRevision) return;
      // A rejected update can leave only one column refreshed. Rebuild the
      // complete list before using the new rows' click handlers.
      diag((error as Error).message);
      fresh.selected = fresh.paintedSelection = positions[mounted.module!].cursor = cursor;
      await show(fresh);
    } finally { mounted.paging = false; }
  });
  sessionCursorWrites = write.catch(e => diag((e as Error).message));
  return sessionCursorWrites;
}

function moduleRowText(list: SessionMenuScreen): [number, string, string][] {
  if (list.compat) return [[BODY.containerID, BODY.containerName, compatibilityText(list)]];
  return [
    [MENU_LEFT.containerID, MENU_LEFT.containerName, menuNativeText(list.columns!)],
    [6, 'menu-right', list.columns!.map(row => nativeRight(row.right, MENU_RIGHT.width)).join('\n')],
    [MENU_COUNT.containerID, MENU_COUNT.containerName, nativeRight(list.count ?? '', MENU_COUNT.width)],
    [MENU_CURSOR.containerID, MENU_CURSOR.containerName, menuCursorText(list.columns!, list.selected ?? 0, list.menuFrame)],
  ];
}

function home(page = positions.coding.page, selected = positions.coding.cursor, mounted?: SessionMenuScreen) {
  selectThread(null);
  return guard('Orca-glass', async () => {
    const owner = current;
    const revision = moduleRevision;
    const allThreads = await api.threads().catch(e => { if (mounted || current !== owner || revision !== moduleRevision) return null; throw e; });
    if (!allThreads) return; // The cached rows remain usable during a refresh failure.
    if (current !== owner || revision !== moduleRevision) return;
    // Hermes Agent lists only Hermes sessions; the Coding filters
    // exclude Hermes. Each side applies its own workspace selection.
    const selection = activeWorkspaces();
    const threads = allThreads.filter(t => (hermesView() ? t.agent === 'hermes' : t.agent !== 'hermes' && (viewProvider === 'all' || t.agent === viewProvider))
      && (selection === null || !!t.workspaceId && selection.has(t.workspaceId)));
    for (const t of allThreads) if (t.workspaceId) workspaceNames.set(t.workspaceId, (t.agent === 'hermes' ? t.workspaceLabel : t.workspaceName) || t.workspaceLabel || t.workspaceName || tr('workspaceFallback'));
    const workspaceFilter = workspaceSummary(selection, workspaceNames);
    const pageSize = 7; // Nine native rows: two filters plus seven sessions.
    const pageCount = Math.max(1, Math.ceil(threads.length / pageSize));
    page = Math.max(0, Math.min(page, pageCount - 1));
    const start = page * pageSize;
    const visible = threads.slice(start, start + pageSize);
    const actions: { label: string; run: () => unknown }[] = [
      { label: `* ${tr('filterAgent')} [${providerFilterLabel()}]`, run: () => { enterPage('agents'); return viewOptions(); } },
      { label: `* ${tr('filterWorkspace')} [${workspaceFilter}]`, run: () => { enterPage('workspaces'); return workspaceOptions(); } },
      ...visible.map(t => ({ label: sessionRow(t.title, t.handle, t.agent, t.state, t.workspaceName), run: () => thread(t) })),
    ];
    const columns = actions.map((a, i): SessionColumns => {
      const t = i >= 2 ? visible[i - 2] : undefined;
      if (t) return { marker: t.state === 'idle' ? '/' : t.state === 'busy' ? '' : '?', title: compactSessionTitle(t.title, t.handle), right: sessionAgentLabel(t.workspaceName || '', t.agent), busy: t.state === 'busy', handle: t.handle };
      return i === 0 ? { marker: '*', title: tr('filterAgent'), right: `[${providerFilterLabel()}]` }
        : i === 1 ? { marker: '*', title: tr('filterWorkspace'), right: `[${workspaceFilter}]` } : { marker: '', title: a.label, right: '' };
    });
    await showModuleList('coding', page, selected, { columns, count: tr('sessionCount', allThreads.length), firstItem: 2,
      onPreviousPage: page > 0 ? () => home(page - 1, -1) : undefined,
      onNextPage: page + 1 < pageCount ? () => home(page + 1, 1) : undefined,
      menuActions: [
        { id: 1001, label: tr('refreshSessions'), run: () => home(page, 1) },
        ...(orcaAvailable ? [{ id: 1002, label: tr('menuNewSession'), run: (up?: Up) => { enterPage('newSession', up); return newSession(); } }] : []),
        { id: 1003, label: tr('menuUsage'), run: (up?: Up) => { enterPage('usage', up); return usage(); } },
      ],
      items: actions.map(a => a.label),
      onPick: i => { actions[i]?.run(); } }, mounted);
  }, home);
}

// A cold bridge answers with the threads it fetched within its wait budget. While the page is
// incomplete, read it again and redraw the rows in place (bounded: about 15 s).
const MAIL_RETRY_MS = 1500, MAIL_RETRIES = 10;
let mailRetryTimer: ReturnType<typeof setTimeout> | undefined;

// Rows above the threads: the mailbox on screen when there are two or more (a click switches to
// the next one; Eugene, 2026-11-27), then Filter by Label.
function mailLeadRows(mailbox: string, filterColumn: string): SessionColumns[] {
  return [...(mailbox ? [{ marker: '*', title: mailbox, right: '' }] : []), { marker: '*', title: tr('mailFilter'), right: filterColumn }];
}
function pickMailLead(i: number, mailbox: string): boolean {
  if (mailbox && i === 0) { void switchMailbox(); return true; }
  if (i === (mailbox ? 1 : 0)) { enterPage('mailLabels'); void mailLabels(0, 0, true); return true; }
  return false;
}
// The loading screen: the lead rows and a moving-dot row. No count, so it is never cached.
function mailLoadingContent(mailbox: string): ModuleListContent {
  const columns = [...mailLeadRows(mailbox, ''), { marker: '', title: tr('mailLoading'), right: '', busy: true }];
  return { columns, items: columns.map(row => row.title),
    menuActions: [{ id: 1001, label: tr('refresh'), run: () => mailHome() }],
    onPick: i => { pickMailLead(i, mailbox); } };
}

// Glasses: switch to the next mailbox, show its loading row in place at once, then its threads.
async function switchMailbox() {
  const next = mail.nextMailbox();
  const list = current;
  if (!next || list?.kind !== 'list' || list.module !== 'email') return;
  await applyMailFilter(MAIL_ACCOUNTS_KEY, mail.selectMailbox(next), false);
  if (current !== list) return;
  await showModuleList('email', 0, 1, mailLoadingContent(mail.mailboxName()), list);
  if (current === list) await mailHome(0, undefined, list, 0, true);
}

// Phone: choose a mailbox; the same refresh path as a label toggle.
async function selectMailAccount(id: string) {
  if (id === mail.currentMailbox()) return;
  await applyMailFilter(MAIL_ACCOUNTS_KEY, mail.selectMailbox(id), true);
}

// loadingShown: the rows on screen are the loading screen, so a failure replaces them.
type MailListResult = Awaited<ReturnType<Mail['list']>>;
// The Email list rows for one page; the screen and the background preload both use it.
function mailListContent(result: MailListResult, page: number, loadingRow: boolean): ModuleListContent {
  const lead = mailLeadRows(result.mailbox, result.filterColumn);
  const columns = [...lead, ...result.items.map(item => mailColumns(item))];
  if (loadingRow) columns.push({ marker: '', title: tr('mailLoadingMore'), right: '', busy: true });
  // firstItem/mailItems: the keyboard acts on the thread under the cursor and j/k in the reader
  // move along these rows.
  return { columns, count: tr('mailUnread', result.unread), firstItem: lead.length, mailItems: result.items,
    items: columns.map(row => `${row.marker || ' '} ${row.title} ${row.right}`),
    onPreviousPage: page > 0 ? () => mailHome(page - 1, -1) : undefined,
    onNextPage: result.hasMore ? () => mailHome(page + 1, 1) : undefined,
    menuActions: [{ id: 1001, label: tr('refresh'), run: () => mailHome() }],
    onPick: i => { if (!pickMailLead(i, result.mailbox) && result.items[i - lead.length]) void openMail(result.items[i - lead.length]); },
  };
}

// Email loads in the background while Coding or Chat is on screen (Eugene, 2026-11-27: "the emails
// already start loading even if the chat and the code are open"). The page is cached, so a switch
// to Email paints it at once and then refreshes it in place. It also keeps the bridge's Gmail cache
// warm. First load shortly after connecting; then every three minutes; a cold, incomplete page is
// read again after a few seconds (at most five times). Nothing runs while Email is on screen.
const MAIL_PRELOAD_FIRST_MS = 2000, MAIL_PRELOAD_MS = 3 * 60_000, MAIL_PRELOAD_RETRY_MS = 3000, MAIL_PRELOAD_RETRIES = 5;
let mailPreloadTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleMailPreload(delay = MAIL_PRELOAD_MS, attempt = 0) {
  clearTimeout(mailPreloadTimer);
  mailPreloadTimer = setTimeout(() => { void preloadMail(attempt); }, delay);
}
// The demo has no bridge to warm and no latency to hide.
let demoConnection = false;
const onEmail = () => activeModule === 'email';
async function preloadMail(attempt = 0) {
  if (!modules.includes('email') || demoConnection) return;
  if (onEmail()) { scheduleMailPreload(); return; }
  const page = positions.email.page;
  const filterRevision = mailFilterRevision;
  try {
    const result = await mail.list(page);
    if (onEmail() || filterRevision !== mailFilterRevision) { scheduleMailPreload(); return; }
    const incomplete = result.loading ?? (result.items.length < result.size && result.hasMore);
    // An empty cold answer is not cached: Email would open on an empty list.
    if (result.items.length || !incomplete) moduleCache.set('email', { page, content: mailListContent(result, page, false) });
    if (incomplete && attempt < MAIL_PRELOAD_RETRIES) { scheduleMailPreload(MAIL_PRELOAD_RETRY_MS, attempt + 1); return; }
  } catch { /* Email unavailable now; opening it shows why, and the next preload tries again. */ }
  scheduleMailPreload();
}

async function mailHome(page = positions.email.page, selected = positions.email.cursor, mounted?: SessionMenuScreen, retry = 0, loadingShown = false) {
  clearTimeout(mailRetryTimer);
  selectThread(null);
  let owner = current;
  let placeholder = loadingShown;
  const revision = moduleRevision;
  const filterRevision = mailFilterRevision;
  const active = () => current === owner && revision === moduleRevision && filterRevision === mailFilterRevision;
  try {
    // Nothing cached yet (first open after a start): show the Email screen at once with a moving
    // dot, then fill its rows in place. No count, so this placeholder is never cached.
    if (!mounted && !moduleCache.has('email')) {
      mounted = await showModuleList('email', page, selected, mailLoadingContent(mail.mailboxName()));
      if (current !== mounted || revision !== moduleRevision || filterRevision !== mailFilterRevision) return;
      owner = mounted;
      placeholder = true;
    }
    let result = await mail.list(page);
    // A changed filter or external mailbox activity can remove the last page.
    // Bridges before 1.0.65 send no loading flag: a short page that has a next page is incomplete.
    const loading = () => result.loading ?? (result.items.length < result.size && result.hasMore);
    while (page > 0 && !result.items.length && !result.hasMore && !loading() && active()) result = await mail.list(--page);
    if (!active()) return;
    // An incomplete page keeps a moving-dot row below its threads while it fills in.
    const shown = await showModuleList('email', page, selected,
      mailListContent(result, page, loading() && retry < MAIL_RETRIES && result.items.length < result.size), mounted);
    if (loading() && retry < MAIL_RETRIES) {
      mailRetryTimer = setTimeout(() => {
        // Only while this list is still on screen with the same module and filter.
        if (current === shown && revision === moduleRevision && filterRevision === mailFilterRevision && !shown.paging)
          void mailHome(page, undefined, shown, retry + 1);
      }, MAIL_RETRY_MS);
    }
  } catch {
    // A failed refresh keeps the rows on screen; a failed first load replaces the loading row.
    if (mounted && !placeholder) return;
    const mailbox = mail.mailboxName();
    const lead = mailLeadRows(mailbox, '');
    if (active()) await showModuleList('email', page, 0, {
      columns: [...lead, { marker: '', title: tr('mailUnavailable'), right: '' }],
      items: [...lead.map(row => row.title), tr('mailUnavailable')],
      headings: [lead.length + 1],
      menuActions: [{ id: 1001, label: tr('refresh'), run: () => mailHome() }],
      onPick: i => { pickMailLead(i, mailbox); },
    });
  }
}

async function chatHome(page = positions.chat.page, selected = positions.chat.cursor, mounted?: SessionMenuScreen) {
  selectThread(null);
  const owner = current;
  const revision = moduleRevision;
  const filterRevision = chatFilterRevision;
  const active = () => current === owner && revision === moduleRevision && filterRevision === chatFilterRevision;
  const filter = { marker: '*', title: tr('mailFilter'), right: '' };
  const pickFilter = () => { enterPage('chatNetworks'); void chatNetworks(); };
  const menuActions = [{ id: 1001, label: tr('refresh'), run: () => chatHome() }];
  try {
    let result = await chat.list(page);
    while (page > 0 && !result.items.length && !result.hasMore && active()) result = await chat.list(--page);
    if (!active()) return;
    const columns = [{ ...filter, right: result.filterColumn }, ...result.items.map(chatColumns)];
    await showModuleList('chat', page, selected, { columns, count: tr('chatUnread', result.unread), firstItem: 1,
      items: columns.map(row => `${row.marker} ${row.title} ${row.right}`),
      onPreviousPage: page > 0 ? () => chatHome(page - 1, -1) : undefined,
      onNextPage: result.hasMore ? () => chatHome(page + 1, 1) : undefined,
      menuActions,
      onPick: i => { if (i === 0) pickFilter(); else if (result.items[i - 1]) void openChat(result.items[i - 1]); },
    }, mounted);
  } catch {
    if (!mounted && active()) await showModuleList('chat', page, 0, {
      columns: [filter, { marker: '', title: tr('chatUnavailable'), right: '' }],
      items: [filter.title, tr('chatUnavailable')], headings: [2], menuActions,
      onPick: i => { if (i === 0) pickFilter(); },
    });
  }
}

async function toggleChatNetwork(name: string | null, networks: string[], fromPhone = false) {
  const value = chat.toggle(name, networks);
  const revision = ++chatFilterRevision;
  const owner = current;
  moduleCache.delete('chat');
  positions.chat.page = 0;
  phone?.render();
  chatStorageWrites = chatStorageWrites.then(async () => { await bridge.setLocalStorage(CHAT_NETWORKS_KEY, value); })
    .catch(e => diag((e as Error).message));
  await chatStorageWrites;
  if (!fromPhone || current !== owner || revision !== chatFilterRevision || activeModule !== 'chat') return;
  if (owner?.kind === 'list' && owner.chatPicker) await chatNetworks(owner.chatPicker.page, owner.selected, networks);
  else if (owner?.kind === 'list' && owner.module === 'chat') await chatHome(0);
  else if (modulePending) await finishModuleSwitch(owner, moduleRevision);
}

async function chatNetworks(page = 0, selected = 0, catalog?: string[]) {
  // Done shows the filtered list; going back returns to the menu that opened the picker, if any.
  const done = () => { delete pageUp.chatNetworks; return chatHome(positions.chat.page, 1); };
  const back = () => leavePage('chatNetworks', () => chatHome(positions.chat.page, 1));
  const owner = current;
  const revision = moduleRevision;
  try {
    const networks = catalog ?? await chat.networks();
    if (current !== owner || revision !== moduleRevision || activeModule !== 'chat') return;
    const size = 8;
    page = Math.max(0, Math.min(page, Math.ceil(networks.length / size) - 1));
    const visible = networks.slice(page * size, (page + 1) * size);
    const check = (on: boolean, label: string) => `[${on ? 'x' : ' '}] ${label}`;
    const items = [tr('done'), check(chat.isAll(), tr('chatAllNetworks')),
      ...visible.map(name => check(chat.isSelected(name), name))];
    await show({ kind: 'list', workspacePicker: true, chatPicker: { page, networks }, title: tr('chatFilterNetwork'),
      items, selected: selected < 0 ? items.length - 1 : Math.min(selected, items.length - 1),
      onPreviousPage: page ? () => chatNetworks(page - 1, -1, networks) : undefined,
      onNextPage: (page + 1) * size < networks.length ? () => chatNetworks(page + 1, 2, networks) : undefined,
      onBack: back, onPick: async i => {
        if (i === 0) { await done(); return; }
        const picker = current;
        await toggleChatNetwork(i === 1 ? null : visible[i - 2], networks);
        if (current === picker) await chatNetworks(page, i, networks);
      },
    });
  } catch {
    if (current === owner && revision === moduleRevision) await show({ kind: 'text', title: moduleLabel('chat'), text: tr('chatUnavailable'), onBack: back, onClick: back });
  }
}

function saveMailPref(key: string, value: string) {
  mailStorageWrites = mailStorageWrites.then(async () => { await bridge.setLocalStorage(key, value); }).catch(e => diag((e as Error).message));
  return mailStorageWrites;
}

async function toggleMailLabel(key: string, fromPhone = false) {
  await applyMailFilter(MAIL_LABELS_KEY, mail.toggle(key), fromPhone);
}

async function applyMailFilter(storageKey: string, stored: string, fromPhone: boolean) {
  const revision = ++mailFilterRevision;
  moduleCache.delete('email');
  positions.email.page = 0;
  phone?.render();
  const owner = current;
  await saveMailPref(storageKey, stored);
  if (fromPhone && current === owner && revision === mailFilterRevision && activeModule === 'email') {
    if (owner?.kind === 'list' && owner.mailPicker) await mailLabels(owner.mailPicker.page, owner.selected ?? 0, false, owner.mailPicker.search);
    else if (owner?.kind === 'list' && owner.module === 'email') await mailHome(0);
    else if (modulePending) await finishModuleSwitch(owner, moduleRevision);
  }
}

// Typed label search (Bluetooth keyboard) in the glasses label picker: letters, digits and spaces
// build the query, Backspace removes one character; the picker redraws 0.4 s after the last key.
// Returns false for keys it does not handle (arrows, Enter, Esc, and Backspace on an empty query).
let typedLabelSearch = '';
let typedLabelTimer: ReturnType<typeof setTimeout> | undefined;
function typeLabelSearch(key: string, shown: string): boolean {
  if (!typedLabelSearch && shown) typedLabelSearch = shown;
  if (key === 'Backspace') {
    if (!typedLabelSearch) return false;
    typedLabelSearch = typedLabelSearch.slice(0, -1);
  } else if (key.length === 1) typedLabelSearch += key;
  else return false;
  clearTimeout(typedLabelTimer);
  const query = typedLabelSearch;
  typedLabelTimer = setTimeout(() => { void mailLabels(0, 0, false, query.trim()); }, 400);
  return true;
}

async function mailLabels(page: number, selected: number, refresh = false, search = '') {
  if (!search) typedLabelSearch = '';
  const owner = current;
  const revision = moduleRevision;
  try {
    const pages = await mail.picker(refresh, search);
    if (current !== owner || revision !== moduleRevision) return;
    page = Math.min(page, pages.length - 1);
    const rows = pages[page];
    const headings = rows.flatMap((row, i) => row.heading ? [i] : []);
    let cursor = selected < 0 ? rows.length - 1 : Math.min(selected, rows.length - 1);
    while (headings.includes(cursor)) cursor--;
    // Done shows the filtered list; going back returns to the menu that opened the picker, if any.
    const done = () => { delete pageUp.mailLabels; return mailHome(positions.email.page, 1); };
    const back = () => leavePage('mailLabels', () => mailHome(positions.email.page, 1));
    await show({ kind: 'list', workspacePicker: true, mailPicker: { page, search }, title: ' ', items: rows.map(row => row.text), headings, selected: cursor,
      onPreviousPage: page > 0 ? () => mailLabels(page - 1, -1, false, search) : undefined,
      onNextPage: page + 1 < pages.length ? () => {
        const next = pages[page + 1].findIndex((row, index) => index > 0 && !row.heading);
        return mailLabels(page + 1, Math.max(next, 0), false, search);
      } : undefined,
      onPick: async i => {
        const row = rows[i];
        if (i === 0) { await done(); return; }
        if (!row?.key) return;
        const picker = current;
        await toggleMailLabel(row.key);
        if (current === picker) await mailLabels(page, i, false, search);
      }, onBack: search ? () => mailLabels(0, 0) : back,
      onHold: voiceAvailable ? () => { void record({ search: text => mailLabels(0, 0, false, text) }, true); } : undefined,
    });
  } catch {
    if (current === owner && revision === moduleRevision) {
      const back = () => leavePage('mailLabels', mailHome);
      await show({ kind: 'text', title: moduleLabel('email'), text: tr('mailUnavailable'), onBack: back, onClick: back });
    }
  }
}

// Filter by Agent: Hermes Agent first, a divider, then All Orca sessions and each
// Orca agent harness (Claude, Codex, then any others seen). Rendered as native
// text so the divider is not selectable.
// Filter by Agent: Hermes Agent, All Orca Sessions, then each Orca agent. No
// title, divider or back row (double-click returns, 2026-11-10): ten rows. A list
// longer than one page ends with a non-selectable 'v more below' row, and later
// pages start with '^ more above'; swiping onto either turns the page.
const AGENT_ROWS = 10;
export const MORE_BELOW = 'v more below';
export const MORE_ABOVE = '^ more above';
const moreBelow = () => tr('moreBelow');
const moreAbove = () => tr('moreAbove');
function viewOptions(page?: number, selected?: number) {
  return guard(tr('filterAgent'), async () => {
    const threads = await api.threads();
    const orca = orcaAgents(threads, viewProvider);
    const choose = (id: string) => async () => {
      delete pageUp.agents; // a choice shows the filtered list
      await bridge.setLocalStorage('view-provider', id);
      viewProvider = id;
      moduleCache.delete('coding');
      phone?.render();
      await home(0, 0);
    };
    const label = (id: string, name: string) => `${name}${viewProvider === id ? ' ✓' : ''}`;
    const actions: { label: string; run: () => unknown }[] = [
      { label: label('hermes', 'Hermes Agent'), run: choose('hermes') },
      ...orca.map(id => ({ label: label(id, id === 'all' ? tr('allOrcaSessionsRow') : providerName(id)), run: choose(id) })),
    ];
    // Fill pages, keeping a row for each cue the page needs.
    const pages: (typeof actions)[] = [];
    for (let i = 0; i < actions.length;) {
      let room = AGENT_ROWS - (pages.length ? 1 : 0);
      if (actions.length - i > room) room--;
      pages.push(actions.slice(i, i + room));
      i += room;
    }
    // Open on the page that holds the current choice.
    const ticked = (rows: typeof actions) => rows.findIndex(a => a.label.endsWith(' ✓'));
    const at = Math.max(0, Math.min(page ?? Math.max(0, pages.findIndex(rows => ticked(rows) >= 0)), pages.length - 1));
    const cue = { run: () => {} };
    const rows = [...(at > 0 ? [{ ...cue, label: moreAbove(), cue: true }] : []), ...pages[at],
      ...(at + 1 < pages.length ? [{ ...cue, label: moreBelow(), cue: true }] : [])];
    const headings = rows.map((row, i) => 'cue' in row ? i : -1).filter(i => i >= 0);
    let selection = selected === undefined ? Math.max(0, ticked(rows)) : selected < 0 ? rows.length - 1 : Math.min(selected, rows.length - 1);
    while (headings.includes(selection)) selection += selection === 0 ? 1 : -1;
    await show({ kind: 'list', agentPicker: true, title: tr('filterAgent'), items: rows.map(a => a.label), headings, selected: selection,
      onPreviousPage: at > 0 ? () => viewOptions(at - 1, -1) : undefined,
      onNextPage: at + 1 < pages.length ? () => viewOptions(at + 1, 1) : undefined,
      onPick: i => { if (!headings.includes(i)) void rows[i]?.run(); }, onBack: () => leavePage('agents', home) });
  }, () => { void leavePage('agents', home); });
}

// null means all workspaces; an explicit empty set means none. Keep each
// toggle selected in a native text page so multiple picks do not jump to row 1.
// Ten rows, no title: Done, All, then sections paged eight entries at a time.
// Orca: Recent workspaces (four most recently active), then Other workspaces
// (alphabetical). Hermes (not part of Orca): Bots, Sessions, Scheduled jobs, as
// in Hermes Desktop. Headings are not selectable and never end a page.
const PICKER_ROWS = 10;
function workspaceOptions(page = 0, selected = 0) {
  return guard(tr('filterWorkspace'), async () => {
    const owner = current;
    const [threads, catalog] = await Promise.all([api.threads(), api.workspaces().catch(() => [])]);
    if (current !== owner) return;
    const hermesOnly = hermesView();
    const chosen = activeWorkspaces();
    const sections = workspaceSections(threads, catalog, hermesOnly, chosen, workspaceNames);
    // Flatten to headings and rows, then page eight entries below Done/All.
    const flat: ({ heading: string } | { row: PickerRow })[] = sections.filter(x => x.rows.length)
      .flatMap(x => [...(x.title ? [{ heading: x.title }] : []), ...x.rows.map(row => ({ row }))]);
    const perPage = PICKER_ROWS - 2;
    const pages: typeof flat[] = [[]];
    for (const entry of flat) {
      const last = pages.at(-1)!;
      if (last.length === perPage || ('heading' in entry && last.length === perPage - 1)) pages.push([]);
      pages.at(-1)!.push(entry);
    }
    page = Math.max(0, Math.min(page, pages.length - 1));
    const save = async () => { positions.coding.page = 0; await saveActiveWorkspaces(); };
    const actions: { label: string; run: () => unknown }[] = [
      { label: tr('done'), run: () => { delete pageUp.workspaces; return home(); } },
      { label: `[${chosen === null ? 'x' : ' '}] ${tr('allWorkspaces')}`, run: async () => { const owner = current; setActiveWorkspaces(null); await save(); if (current === owner) await workspaceOptions(page, 1); } },
    ];
    const headings: number[] = [];
    for (const entry of pages[page]) {
      const index = actions.length;
      if ('heading' in entry) { headings.push(index); actions.push({ label: entry.heading, run: () => {} }); continue; }
      const [id, name] = entry.row;
      actions.push({ label: `[${chosen?.has(id) ? 'x' : ' '}] ${name}`, run: async () => {
        setActiveWorkspaces(toggleWorkspace(activeWorkspaces(), id));
        const owner = current; await save(); if (current === owner) await workspaceOptions(page, index);
      } });
    }
    let selection = selected < 0 ? actions.length - 1 : Math.min(selected, actions.length - 1);
    while (headings.includes(selection)) selection--;
    await show({ kind: 'list', workspacePicker: true, title: tr('filterWorkspace'), items: actions.map(a => a.label), headings, selected: selection,
      onPreviousPage: page > 0 ? () => workspaceOptions(page - 1, -1) : undefined,
      onNextPage: page + 1 < pages.length ? () => workspaceOptions(page + 1) : undefined,
      onPick: i => { if (!headings.includes(i)) void actions[i]?.run(); }, onBack: () => leavePage('workspaces', home) });
  }, () => { void leavePage('workspaces', home); });
}

function thread(t: Thread, note = '') {
  visit({ key: `coding:${t.handle}`, label: t.title, module: 'coding', open: () => thread(t) }, true);
  const load = async () => {
    const snapshot = await api.thread(t.handle);
    const saved = await api.history(t.handle).catch(() => null);
    const useSaved = ['codex-transcript', 'claude-transcript', 'cursor-transcript', 'opencode-transcript', 'pi-transcript', 'hermes-transcript', 'orca-chat'].includes(saved?.source || '');
    const conversationText = useSaved ? saved!.text : snapshot.text;
    const state = await api.activity(t.handle).catch(e => {
      diag(`Activity request failed: ${(e as Error).message}`);
      return { state: 'unknown', elapsedSeconds: null };
    });
    const text = readerContent(conversationText, snapshot.menu, snapshot.progress, t.agent === 'claude' && state.state === 'working');
    if ('readOnly' in state && typeof state.readOnly === 'boolean') t.readOnly = state.readOnly;
    return { text, conversationText, choiceMenu: snapshot.menu, model: (useSaved ? saved!.model : undefined) || snapshot.model || t.model, activityState: state.state, reportedSeconds: state.state === 'working' ? state.elapsedSeconds ?? null : null, activityLabel: activityLabel(state.state), savedHistory: useSaved };
  };
  const source = { title: `${t.title}${note ? `  ${note}` : ''}`, load, coding: t,
    hold: () => { if (!t.readOnly) void record({ thread: t }, true); },
    image: (n: number, request?: ImageRequest) => api.historyImage(t.handle, n, request) };
  return guard(t.title, async () => {
    const screen = await openReader(source, home, () => {
      if (current?.kind === 'text' && current.choiceMenu) void replies(t);
      else openPageImage(current);
    });
    if (screen && current === screen) selectThread(t);
  }, home);
}

async function openReader<T extends ReaderContent>(source: ReaderSource<T> & { coding?: Thread }, onBack: () => void, onClick?: () => void) {
  const owner = current;
  const revision = moduleRevision;
  const loaded = await source.load();
  if (current !== owner || revision !== moduleRevision) return;
  const screen: TextScreen = { ...loaded, kind: 'text', title: source.title, tail: true, openAtResponse: true, reader: source, onBack, onClick };
  await show(screen);
  if (current !== screen) return;
  if (!source.afterDisplay) return screen;
  await source.afterDisplay();
  if (current === screen && source.statusText) {
    const label = source.statusText();
    if (label !== screen.activityLabel) {
      screen.activityLabel = label;
      await writePanel(label, () => current === screen);
    }
  }
  return screen;
}

async function openMail(thread: MailThread) {
  visit({ key: `mail:${thread.account}:${thread.id}`, label: `${thread.from} - ${thread.subject}`.replace(/\s+/g, ' '), module: 'email', open: () => openMail(thread) }, true);
  const owner = current;
  const revision = moduleRevision;
  const back = () => mailHome();
  const unread = thread.unread;
  try {
    await openReader(mail.reader(thread), back, () => { openPageImage(current); });
    if (unread && !thread.unread) void phone?.refreshLabels();
  }
  catch {
    if (current === owner && revision === moduleRevision) await show({ kind: 'text', title: moduleLabel('email'), text: tr('mailUnavailable'), onBack: back, onClick: back });
  }
}

async function openChat(item: ChatItem) {
  visit({ key: `chat:${item.id}`, label: item.title, module: 'chat', open: () => openChat(item) }, true);
  const owner = current;
  const revision = moduleRevision;
  const back = () => chatHome();
  let outcome: 'chatSent' | 'chatNotSent' | undefined;
  const hold = voiceAvailable && !item.readOnly ? () => {
    void record({ reply: async text => (await api.chat.send(item.id, text)).ok,
      onResult: sent => { outcome = sent ? 'chatSent' : 'chatNotSent'; } }, true);
  } : undefined;
  let readFailed = false;
  setReplyTarget(item.readOnly ? null : { key: `chat:${item.id}`, label: tr('replyTo', item.title, moduleLabel('chat')),
    send: async text => { if (!(await api.chat.send(item.id, text)).ok) throw new Error(tr('chatNotSent')); } });
  // Re-read the features in the background: Ollama may have started since the app connected.
  void api.capabilities().then(applyCapabilities, () => {});
  const source = new ChatReader(item, translating, () => outcome ? tr(outcome) : readFailed ? tr('chatNotMarkedRead') : ' ', hold);
  try {
    const screen = await openReader(source, back, () => {
      if (current?.kind !== 'text' || current.reader !== source || current.pageWriting) return;
      const screen = current;
      // A photo on this page opens first; otherwise the click transcribes the page's voice notes.
      if (openPageImage(screen)) return;
      const page = readerLayout(screen)[screen.offset ?? 0];
      const ids = (screen.voiceLines ?? []).filter(({ line }) => line >= page.firstLine && line <= page.lastLine).map(({ id }) => id);
      if (!chatFeatures.transcribe) return;
      void source.transcribe(ids, () => repaintChat(screen).catch(() => {})).catch(() => {});
    });
    // Opening an unread chat on the glasses marks it read in Beeper (Eugene, 2026-11-27), once,
    // after it is on screen; a failure shows in the status row and the chat stays unread.
    if (screen && item.unread) {
      void Promise.resolve().then(() => api.chat.read(item.id)).then(result => {
        if (!result.ok) throw new Error('Mark read failed');
        item.unread = false;
        moduleCache.delete('chat');
      }).catch(() => { readFailed = true; });
    }
    if (screen && current === screen) void translateChat(screen, source);
  } catch {
    if (current === owner && revision === moduleRevision) await show({ kind: 'text', title: moduleLabel('chat'), text: tr('chatUnavailable'), onBack: back, onClick: back });
  }
}

// ---- Keyboard: Gmail shortcuts, mail actions and typed drafts (Eugene, 2026-11-27) ----
// "use standard Gmail keyboard shortcuts as much as possible": the PC keys with keyboard
// shortcuts on. Lists: j/k (or Up/Down) move, o/Enter open. Readers: j/k open the next/previous
// row of the list they came from, Space/Shift+Space page, u/Esc back. Email: c compose, r reply,
// a reply all, f forward, e archive, # delete (to Trash), Shift+U unread, Shift+I read, s star,
// z undo. Coding and Chat: r types a reply. ? shows the keys. Drafts open on the glasses; the
// phone page holds the text boxes, so the browser does the editing. A mail draft reviews with
// Ctrl+Enter (as Gmail sends with it) and a reply with Enter; Enter on the review sends once.
type Draft = {
  key: string; title: string; fields: ComposeFields; sendId: string; focus: ComposeField;
  mail?: { account: string; mode: MailMode; threadId?: string };
  send?: (text: string) => Promise<void>; // a Coding or Chat reply
  loading?: boolean;
};
type Composing = { draft: Draft; background: Screen; screen: TextScreen; review: boolean; sending: boolean; note: string;
  focus: ComposeField; writes: Promise<void>; queued: boolean };
// A closed draft is kept (as Gmail keeps one) until it is sent; the same key opens it again.
const drafts = new Map<string, Draft>();
let composing: Composing | null = null;
// Read through a call: after an await TypeScript would keep an earlier narrowing of `composing`.
const activeDraft = () => composing?.draft;
const COMPOSE_IDS: Record<ComposeField, string> = { to: 'compose-to', cc: 'compose-cc', subject: 'compose-subject', body: 'compose-body' };
const composeFieldsOf = (draft: Draft): ComposeField[] => draft.mail ? MAIL_FIELDS : ['body'];
const fieldId = (draft: Draft, field: ComposeField) => draft.mail ? COMPOSE_IDS[field] : 'reply-text';
const fieldElement = (draft: Draft, field: ComposeField) =>
  document.getElementById(fieldId(draft, field)) as (HTMLInputElement | HTMLTextAreaElement | null);

function nativeMeasure() {
  const ctx = document.createElement?.('canvas').getContext('2d');
  if (ctx) ctx.font = '21px Arial';
  return (text: string) => glassTextWidth(text, ch => ctx ? ctx.measureText(ch).width : 21);
}

function readDraftFields(c: Composing) {
  for (const field of composeFieldsOf(c.draft)) {
    const el = fieldElement(c.draft, field);
    if (el) c.draft.fields[field] = el.value;
  }
}

// The page of the draft that holds the cursor while typing; the first page on review.
function composeContent(c: Composing) {
  readDraftFields(c);
  const editing = !c.review && !c.sending;
  const el = editing ? fieldElement(c.draft, c.focus) : null;
  const cursor = typeof el?.selectionStart === 'number' ? el.selectionStart : undefined;
  const raw = composeText(c.draft.title, c.draft.fields, !!c.draft.mail, editing ? c.focus : undefined, cursor);
  const pages = readerPages(raw, nativeMeasure(), READER_WRAP_WIDTH, READER_ROWS);
  const page = editing ? pages.find(p => p.text.includes(CURSOR_MARK)) ?? pages[pages.length - 1] : pages[0];
  const hint = c.note || (c.sending ? tr('sending') : c.review ? tr('composeReviewHint')
    : c.draft.loading ? tr('composeLoading') : tr(c.draft.mail ? 'composeHintMail' : 'composeHintReply'));
  return { text: page.text.replace(CURSOR_MARK, CURSOR) || ' ', hint };
}

// Coalesced and serialized: one write in flight, at most one queued behind it, so fast typing
// sends only the latest text.
function renderCompose() {
  const c = composing;
  if (!c) return Promise.resolve();
  if (c.queued) return c.writes;
  c.queued = true;
  c.writes = c.writes.then(async () => {
    c.queued = false;
    if (composing !== c) return;
    const { text, hint } = composeContent(c);
    const s = c.screen;
    const before = { text: s.text, hint: s.voiceHint };
    Object.assign(s, { text, voiceHint: hint });
    if (current !== s) { await show(s); return; }
    if (before.text !== text && !await bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: VOICE_BODY.containerID, containerName: VOICE_BODY.containerName, content: voiceBodyText(s) })))
      throw new Error(tr('screenRejected'));
    if (before.hint !== hint && !await bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: VOICE_HINT.containerID, containerName: VOICE_HINT.containerName, content: hint || ' ', textColor: textBrightness() })))
      throw new Error(tr('screenRejected'));
  }).catch(e => diag((e as Error).message));
  return c.writes;
}

function focusComposeField(c: Composing, field: ComposeField, atEnd: boolean) {
  c.focus = field;
  const el = fieldElement(c.draft, field);
  el?.focus?.();
  if (atEnd && el) { try { el.setSelectionRange?.(el.value.length, el.value.length); } catch { /* not a text box */ } }
}

async function openCompose(draft: Draft) {
  const background = current;
  if (composing || recording !== null || !background) return;
  await (background.kind === 'text' ? readerWrites : sessionCursorWrites);
  if (current !== background || composing) return;
  if (background.kind === 'text') background.reading = true;
  clearInterval(poll);
  clearInterval(statusAnimation);
  clearTimeout(mailRetryTimer);
  const screen: TextScreen = { kind: 'text', title: ' ', text: ' ', voice: true, voiceHint: ' ' };
  const c: Composing = { draft, background, screen, review: false, sending: false, note: '', focus: draft.focus, writes: Promise.resolve(), queued: false };
  composing = c;
  // Glasses gestures: a tap reviews (then sends), a double tap goes back.
  screen.onClick = () => { if (c.review) void composeSend(); else composeReview(); };
  screen.onBack = () => { if (c.sending) return; if (c.review) composeEdit(); else void closeCompose(); };
  for (const field of composeFieldsOf(draft)) {
    const el = fieldElement(draft, field);
    if (el) el.value = draft.fields[field];
  }
  if (draft.mail) {
    document.getElementById('mail-compose')!.hidden = false;
    document.getElementById('mail-compose-title')!.textContent = draft.title;
  }
  focusComposeField(c, draft.focus, true);
  await renderCompose();
}

function composeReview() {
  const c = composing;
  if (!c || c.sending || c.review || c.draft.loading) return;
  readDraftFields(c);
  const missing = c.draft.mail ? !hasRecipient(c.draft.fields) : !c.draft.fields.body.trim();
  if (missing) { c.note = tr(c.draft.mail ? 'composeNoRecipient' : 'composeEmpty'); void renderCompose(); return; }
  c.note = '';
  c.review = true;
  // Out of the text box, so Enter reaches the window as "send" rather than a new line.
  fieldElement(c.draft, c.focus)?.blur?.();
  void renderCompose();
}

function composeEdit() {
  const c = composing;
  if (!c || c.sending) return;
  c.review = false;
  c.note = '';
  focusComposeField(c, c.focus, false);
  void renderCompose();
}

async function composeSend() {
  const c = composing;
  if (!c || !c.review || c.sending) return;
  readDraftFields(c);
  const { draft } = c;
  c.sending = true;
  c.note = '';
  await renderCompose();
  try {
    if (draft.mail) {
      const { account, mode, threadId } = draft.mail;
      const result = await api.mail.send({ account, mode, threadId, ...draft.fields, sendId: draft.sendId });
      if (!result.ok) throw new Error('network');
    } else await draft.send!(draft.fields.body.trim());
  } catch (e) {
    if (composing !== c) return;
    c.sending = false;
    const message = (e as Error).message;
    // The same send id is kept, so Enter tries again without any risk of a second mail.
    c.note = draft.mail ? sendError(message) : tr('composeNotSent', message);
    await renderCompose();
    return;
  }
  drafts.delete(draft.key);
  for (const field of composeFieldsOf(draft)) {
    const el = fieldElement(draft, field);
    if (el) el.value = '';
  }
  c.sending = false;
  await closeCompose(true);
}

async function closeCompose(sent = false) {
  const c = composing;
  if (!c) return;
  readDraftFields(c);
  composing = null;
  if (!sent) drafts.set(c.draft.key, { ...c.draft, fields: { ...c.draft.fields }, focus: c.focus, loading: false });
  fieldElement(c.draft, c.focus)?.blur?.();
  if (c.draft.mail) document.getElementById('mail-compose')!.hidden = true;
  await c.writes;
  if (current !== c.screen) return;
  const background = c.background;
  if (background.kind === 'text') Object.assign(background, { reading: false, tail: true, offset: undefined, openAtResponse: false, pageTarget: undefined, pageWriting: false });
  try {
    if (background.kind === 'list' && background.module) await showModule();
    else await show(background);
  } catch (e) { diag((e as Error).message); void showModule(); return; }
  if (!sent) return;
  if (background.kind === 'text' && current === background) {
    void writePanel(statusNote(tr('composeSent')), () => current === background);
    void refreshReader(background);
  } else if (background.kind === 'list' && background.module === 'email') listToast(tr('composeSent'));
}

const MAIL_MODE_LABEL = { new: 'composeNew', reply: 'composeReply', replyAll: 'composeReplyAll', forward: 'composeForward' } as const;

async function startMailDraft(mode: MailMode, thread?: MailThread) {
  if (composing) return;
  const account = thread?.account ?? mail.currentMailbox();
  if (!account || (mode !== 'new' && !thread)) return;
  const key = mode === 'new' ? `mail:new:${account}` : `mail:${mode}:${account}:${thread!.id}`;
  const saved = drafts.get(key);
  if (saved) { await openCompose(saved); return; }
  const where = thread ? thread.subject.replace(/\s+/g, ' ').trim() : mail.mailboxName();
  const label = tr(MAIL_MODE_LABEL[mode]);
  const draft: Draft = {
    key, title: where ? tr('composeTitle', label, where) : label, fields: emptyFields(), sendId: newSendId(),
    focus: mode === 'reply' || mode === 'replyAll' ? 'body' : 'to', mail: { account, mode, threadId: thread?.id }, loading: mode !== 'new',
  };
  await openCompose(draft);
  if (mode === 'new') return;
  let failed = false;
  try {
    const prefill = await api.mail.compose(account, thread!.id, mode);
    // Fill only what was not typed while the prefill was loading.
    for (const field of ['to', 'cc', 'subject'] as const) {
      const value = typeof prefill[field] === 'string' ? prefill[field] : '';
      const el = activeDraft() === draft ? fieldElement(draft, field) : null;
      if (el && !el.value) el.value = value;
      if (!draft.fields[field]) draft.fields[field] = value;
    }
  } catch { failed = true; }
  draft.loading = false;
  const kept = drafts.get(key);
  if (kept && activeDraft() !== draft) Object.assign(kept, { fields: { ...draft.fields, ...kept.fields, to: kept.fields.to || draft.fields.to, cc: kept.fields.cc || draft.fields.cc, subject: kept.fields.subject || draft.fields.subject }, loading: false });
  const open = composing as Composing | null;
  if (open?.draft === draft) {
    if (failed) open.note = tr('composeLoadFailed');
    void renderCompose();
  }
}

// Coding and Chat: r opens the reply on the glasses; the phone's reply box holds the text.
async function startReplyDraft() {
  const target = replyTarget;
  if (!target || target.readOnly || composing) return;
  const key = `reply:${target.key}`;
  const draft = drafts.get(key) ?? { key, title: target.label, sendId: newSendId(), focus: 'body' as const,
    fields: { ...emptyFields(), body: (document.getElementById('reply-text') as HTMLTextAreaElement).value } };
  draft.send = target.send;
  await openCompose(draft);
}

// A short note in the top-right count of a module list for four seconds ("Archived · z undo").
let listToastTimer: ReturnType<typeof setTimeout> | undefined;
function listToast(text: string) {
  const list = current;
  if (list?.kind !== 'list' || !list.module || list.compat) return;
  clearTimeout(listToastTimer);
  const write = (content: string) => {
    sessionCursorWrites = sessionCursorWrites.then(async () => {
      if (current !== list) return;
      await bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: MENU_COUNT.containerID, containerName: MENU_COUNT.containerName,
        content: nativeRight(content, MENU_COUNT.width) }));
    }).catch(e => diag((e as Error).message));
  };
  write(text);
  listToastTimer = setTimeout(() => write(list.count ?? ''), 4000);
}

// Gmail's z: undo the last archive, delete or mark-unread for a minute afterwards.
const MAIL_UNDO = { archive: 'unarchive', trash: 'untrash', unread: 'read' } as const;
const MAIL_NOTES = { archive: 'mailArchived', trash: 'mailTrashed', unread: 'mailMarkedUnread', read: 'mailMarkedRead',
  star: 'mailStarred', unstar: 'mailUnstarred', unarchive: 'mailUndone', untrash: 'mailUndone' } as const;
const MAIL_UNDO_MS = 60_000;
let lastMailAction: { thread: MailThread; undo: MailAction; at: number } | null = null;
let mailActing = false;

async function mailNote(text: string, screen: Screen | null) {
  if (screen?.kind === 'text' && screen.reader && current === screen) await writePanel(statusNote(text), () => current === screen);
  else listToast(text);
}

function selectedMailThread(list: SessionMenuScreen): MailThread | undefined {
  const i = (list.selected ?? 0) - 1 - (list.firstItem ?? 0);
  return i >= 0 ? list.mailItems?.[i] : undefined;
}

async function mailAction(thread: MailThread, action: MailAction, undo = false) {
  if (mailActing || composing) return;
  mailActing = true;
  const screen = current;
  const fromReader = screen?.kind === 'text' && !!screen.reader;
  try {
    const result = action === 'read' ? await api.mail.read(thread.account, thread.id) : await api.mail.modify(thread.account, thread.id, action);
    if (!result.ok) throw new Error('network');
    if (action === 'read' || action === 'unread') thread.unread = action === 'unread';
    if (action === 'star' || action === 'unstar') thread.starred = action === 'star';
    const reverse = (MAIL_UNDO as Partial<Record<MailAction, MailAction>>)[action];
    if (!undo) lastMailAction = reverse ? { thread, undo: reverse, at: Date.now() } : lastMailAction;
    void phone?.refreshLabels();
    const note = tr(undo ? 'mailUndone' : MAIL_NOTES[action]);
    // Archive, delete and mark-unread leave the conversation, as Gmail does; star stays.
    const leaves = action === 'archive' || action === 'trash' || action === 'unread';
    if (fromReader && !leaves) { await mailNote(note, screen); return; }
    if (screen?.kind === 'list' && screen.module === 'email' && current === screen) await mailHome(positions.email.page, undefined, screen);
    else if (fromReader || current?.kind === 'list' && current.module === 'email') await mailHome();
    listToast(note);
  } catch (e) {
    await mailNote(tr('mailActionFailed', (e as Error).message), current);
  } finally { mailActing = false; }
}

async function mailUndo() {
  const last = lastMailAction;
  if (!last || Date.now() - last.at > MAIL_UNDO_MS) { await mailNote(tr('mailNothingToUndo'), current); return; }
  lastMailAction = null;
  await mailAction(last.thread, last.undo, true);
}

// j/k in a reader: the next or previous row of the list it was opened from (Gmail's
// older/newer conversation). Only rows on the list page that is cached; filter rows are skipped.
function openNeighbor(delta: number) {
  const s = current;
  const cached = moduleCache.get(activeModule);
  if (s?.kind !== 'text' || !s.reader || s.voice || !cached || cached.page !== positions[activeModule].page) return;
  const i = positions[activeModule].cursor - 1 + delta;
  if (i < (cached.content.firstItem ?? 0) || i >= cached.content.items.length) return;
  positions[activeModule].cursor = i + 1;
  cached.content.onPick(i);
}

const glassEvent = (eventType: OsEventTypeList) => onEvent({ sysEvent: { eventType } } as unknown as EvenHubEvent);

// ---- IDE keys (Eugene, 2026-11-27: "similar to typical IDEs like VS Code"; all eight chosen) ----
// Ctrl+P quick open, Ctrl+Shift+P command palette, Ctrl+Tab recent (hold Ctrl, Tab moves, release
// opens), Ctrl+F find in the conversation (Enter/F3 next, Shift+Enter/Shift+F3 previous), Ctrl+1/2/3
// modules, Ctrl+Home/End first/last page, Ctrl+R refresh, Ctrl+N new session or mail, Alt+Left/Right
// back and forward through visited lists and conversations.
type Place = { key: string; label: string; module: GlassModule; open: () => unknown };
const recentPlaces: Place[] = [];
const visited: Place[] = [];
let visitedAt = -1;
let restoringPlace = false;
const MODULE_TAG = { coding: 'Coding', email: 'Email', chat: 'Chat' } as const;

// Conversations go to the recent list; conversations and module lists go to the history.
function visit(place: Place, conversation: boolean) {
  if (conversation) {
    const at = recentPlaces.findIndex(p => p.key === place.key);
    if (at >= 0) recentPlaces.splice(at, 1);
    recentPlaces.unshift(place);
    recentPlaces.length = Math.min(recentPlaces.length, 10);
  }
  if (restoringPlace || visited[visitedAt]?.key === place.key) return;
  visited.splice(visitedAt + 1);
  visited.push(place);
  if (visited.length > 50) visited.shift();
  visitedAt = visited.length - 1;
}

// Open a place of any module: the module switches quietly first (its list shows on Back).
function enterModule(module: GlassModule) {
  if (activeModule === module || !modules.includes(module)) return;
  selectModule(module);
  modulePending = false;
}
function goPlace(place: Place) {
  restoringPlace = true;
  try { enterModule(place.module); void Promise.resolve(place.open()).catch(e => diag((e as Error).message)); }
  finally { restoringPlace = false; }
}
function historyStep(step: number) {
  const at = visitedAt + step;
  if (!visited[at] || composing) return;
  visitedAt = at;
  goPlace(visited[at]);
}

// A list on the glasses that narrows as you type (Ctrl+P, Ctrl+Shift+P): row 0 shows the query,
// then up to nine matches (every typed word must appear). Enter opens, Esc returns.
// run gets `up`, which reopens this list as it was (query kept): a page the item opens goes back
// to it, one layer at a time. Places (a session, chat or thread) ignore it and keep their own back.
type FinderItem = { label: string; run: (up: Up) => unknown };
type Finder = { title: string; query: string; items: FinderItem[] | null; back: () => unknown; screen?: Screen; timer?: ReturnType<typeof setTimeout> };
let finder: Finder | null = null;
function finderMatches(f: Finder) {
  const words = f.query.toLowerCase().split(/\s+/).filter(Boolean);
  return (f.items ?? []).filter(item => words.every(word => item.label.toLowerCase().includes(word))).slice(0, 9);
}
function showFinder(f: Finder) {
  const hits = finderMatches(f);
  const rows = [`${f.title}: ${f.query}|`, ...(f.items === null ? [tr('loadingShort')] : hits.length ? hits.map(hit => hit.label) : [tr('finderNoMatch')])];
  const screen: Screen = {
    kind: 'list', textPicker: true, title: ' ', items: rows, headings: hits.length ? [0] : [0, 1], selected: hits.length ? 1 : 0, paintedSelection: hits.length ? 1 : 0,
    onPick: i => {
      const hit = hits[i - 1];
      if (!hit || finder !== f) return;
      finder = null;
      void Promise.resolve(hit.run(() => reopenFinder(f))).catch(e => diag((e as Error).message));
    },
    onBack: () => { if (finder === f) finder = null; void Promise.resolve(f.back()).catch(e => diag((e as Error).message)); },
  };
  f.screen = screen;
  return show(screen);
}
function finderType(f: Finder, key: string): boolean {
  if (key === 'Backspace') f.query = f.query.slice(0, -1);
  else if (key.length === 1) f.query += key;
  else return false;
  clearTimeout(f.timer);
  f.timer = setTimeout(() => { if (finder === f && current === f.screen) void showFinder(f); }, 150);
  return true;
}
function backTo(origin: Screen) {
  return () => origin.kind === 'list' && origin.module ? showModule() : show(origin);
}
function reopenFinder(f: Finder) {
  finder = f;
  return showFinder(f);
}
// back: where Esc goes; the origin screen unless another menu opened this one (Quick Open from the
// command palette goes back to the palette).
function openFinder(title: string, items: FinderItem[] | Promise<FinderItem[]>, origin: Screen, back?: Up) {
  if (composing) return;
  if (origin.kind === 'text') origin.reading = true;
  const f: Finder = { title, query: '', items: Array.isArray(items) ? items : null, back: back ?? backTo(origin) };
  finder = f;
  void showFinder(f);
  if (!Array.isArray(items)) void items.then(list => { f.items = list; if (finder === f && current === f.screen) void showFinder(f); })
    .catch(() => { f.items = []; if (finder === f && current === f.screen) void showFinder(f); });
}

// Ctrl+P: the sessions, chats or mail threads of the module on screen.
async function quickOpenItems(): Promise<FinderItem[]> {
  if (activeModule === 'email') {
    const pages = await Promise.all([0, 1, 2].map(page => mail.list(page).catch(() => null)));
    return pages.flatMap(page => page?.items ?? []).map(item => ({ label: `${item.from} - ${item.subject}`.replace(/\s+/g, ' '), run: () => openMail(item) }));
  }
  if (activeModule === 'chat') {
    const pages = await Promise.all([0, 1, 2, 3, 4].map(page => chat.list(page).catch(() => null)));
    return pages.flatMap(page => page?.items ?? []).map(item => ({ label: item.title, run: () => openChat(item) }));
  }
  return (await api.threads()).map(t => ({ label: `${t.title} [${sessionAgentLabel(t.workspaceName || '', t.agent).replace(/^\[|\]$/g, '')}]`, run: () => thread(t) }));
}

// Ctrl+Shift+P: every action that makes sense from here.
function commandItems(origin: Screen): FinderItem[] {
  const back = backTo(origin);
  const after = (run: () => unknown) => () => Promise.resolve(back()).then(run);
  const reader = origin.kind === 'text' && origin.reader && !origin.voice ? origin : null;
  // Every page an item opens goes back to the palette (`up`), one layer at a time (Eugene,
  // 2026-11-27). Going to a module, Find and Compose act on the screen itself and leave the palette.
  const items: FinderItem[] = modules.map(m => ({ label: tr('commandGoTo', moduleLabel(m)), run: () => choosePhoneModule(m) }));
  items.push({ label: tr('commandQuickOpen'), run: up => openFinder(tr('commandQuickOpenTitle'), quickOpenItems(), origin, up) });
  items.push({ label: tr('commandRecent'), run: up => showRecent(1, up) });
  // Menu actions open their own page directly (no flash of the screen behind the palette).
  for (const action of origin.menuActions ?? []) items.push({ label: action.label, run: up => {
    const list = current;
    return Promise.resolve(action.run(up)).then(() => { if (current === list) return back(); });
  } });
  if (activeModule === 'coding') items.push(
    ...(orcaAvailable ? [{ label: tr('menuNewSession'), run: (up: Up) => { enterPage('newSession', up); return newSession(); } }] : []),
    { label: tr('menuUsage'), run: up => { enterPage('usage', up); return usage(); } },
    { label: tr('filterAgent'), run: up => { enterPage('agents', up); return viewOptions(); } },
    { label: tr('filterWorkspace'), run: up => { enterPage('workspaces', up); return workspaceOptions(); } });
  if (activeModule === 'email') items.push(
    { label: tr('commandCompose'), run: after(() => startMailDraft('new')) },
    { label: tr('mailFilter'), run: up => { enterPage('mailLabels', up); return mailLabels(0, 0, true); } });
  if (activeModule === 'chat') items.push({ label: tr('mailFilter'), run: up => { enterPage('chatNetworks', up); return chatNetworks(); } });
  if (reader) items.push({ label: tr('commandFind'), run: after(() => startFind()) });
  items.push({ label: tr('keysTitle'), run: up => showKeys(up) });
  return items;
}

// Ctrl+Tab: recent conversations, newest first, the cursor on the one before this one.
let switcher: Screen | null = null;
let tabDown = false;
// up: Esc goes back to the menu that opened the list (the command palette) instead of the screen.
// from: the screen under the list; a wrap redraws the list and keeps it (before 1.0.84 a wrap made
// the list its own way back).
function showRecent(start: number, up?: Up, from: Screen | null = current): Promise<void> | undefined {
  if (!recentPlaces.length || composing) return;
  const places = [...recentPlaces];
  const origin = from;
  const at = Math.min(start, places.length - 1);
  const screen: Screen = {
    kind: 'list', textPicker: true, title: ' ', items: places.map(p => `[${MODULE_TAG[p.module]}] ${p.label}`), selected: at, paintedSelection: at,
    // Past either end the cursor wraps, as VS Code's Ctrl+Tab does.
    onNextPage: places.length > 1 ? () => showRecent(0, up, origin) : undefined,
    onPreviousPage: places.length > 1 ? () => showRecent(places.length - 1, up, origin) : undefined,
    // A Ctrl+Tab choice is a new visit (history and recent list), unlike Alt+Left/Right.
    onPick: i => {
      switcher = null;
      const place = places[i];
      if (!place) return;
      enterModule(place.module);
      void Promise.resolve(place.open()).catch(e => diag((e as Error).message));
    },
    onBack: () => { switcher = null; const back = up ?? (origin ? backTo(origin) : undefined); if (back) void Promise.resolve(back()).catch(e => diag((e as Error).message)); },
  };
  switcher = screen;
  return show(screen);
}

// Ctrl+F: the query shows in the status row while you type; Enter finds the next page with it.
let finding: { screen: TextScreen; query: string } | null = null;
let lastFind = '';
function startFind() {
  const s = current;
  if (s?.kind !== 'text' || !s.reader || s.voice || composing) return;
  finding = { screen: s, query: '' };
  void writePanel(statusNote(tr('findPrompt', '|')), () => current === s);
}
function findType(ev: KeyboardEvent): boolean {
  const f = finding!;
  if (ev.key === 'Escape') { finding = null; void writePanel(f.screen.activityLabel ?? ' ', () => current === f.screen); return true; }
  if (ev.key === 'Enter') { findNext(f.screen, f.query, ev.shiftKey ? -1 : 1); return true; }
  if (ev.key === 'Backspace') f.query = f.query.slice(0, -1);
  else if (ev.key.length === 1) f.query += ev.key;
  else return false;
  void writePanel(statusNote(tr('findPrompt', `${f.query}|`)), () => current === f.screen);
  return true;
}
function findNext(s: TextScreen, query: string, step: number) {
  const q = query.trim().toLowerCase();
  if (!q) return;
  lastFind = q;
  const pages = readerLayout(s);
  const offset = s.pageTarget ?? s.offset ?? 0;
  for (let k = 1; k <= pages.length; k++) {
    const i = ((offset + step * k) % pages.length + pages.length) % pages.length;
    if (pages[i].text.toLowerCase().includes(q)) {
      if (i !== offset) flipReader(s, i - offset);
      void writePanel(statusNote(tr('findFound', query.trim(), i + 1, pages.length)), () => current === s);
      return;
    }
  }
  void writePanel(statusNote(tr('findNone', query.trim())), () => current === s);
}

// Keys with Ctrl or Alt. Returns true when used.
function ideKey(ev: KeyboardEvent): boolean {
  const key = keyName(ev);
  const ctrl = ev.ctrlKey || ev.metaKey;
  const s = current;
  if (!s) return false;
  if (key === 'F3' && !ctrl && !ev.altKey) {
    if (s.kind === 'text' && s.reader && (finding?.query || lastFind)) findNext(s, finding?.query || lastFind, ev.shiftKey ? -1 : 1);
    return true;
  }
  if (ev.altKey && !ctrl) {
    if (key === 'ArrowLeft') { historyStep(-1); return true; }
    if (key === 'ArrowRight') { historyStep(1); return true; }
    return false;
  }
  if (!ctrl || ev.altKey) return false;
  // Which Ctrl combinations reach the page (G2 1.0.82: Ctrl+Tab "does nothing"), in the phone log.
  diag(`Key: Ctrl+${ev.shiftKey ? 'Shift+' : ''}${key}`);
  const reader = s.kind === 'text' && s.reader && !s.voice && !s.comparison ? s : null;
  switch (key.length === 1 ? key.toLowerCase() : key) {
    case ',': void showActionMenu(); return true;
    case 'p': openFinder(ev.shiftKey ? tr('commandPaletteTitle') : tr('commandQuickOpenTitle'), ev.shiftKey ? commandItems(s) : quickOpenItems(), s); return true;
    case 'Tab':
      if (switcher && current === switcher) glassEvent(ev.shiftKey ? OsEventTypeList.SCROLL_TOP_EVENT : OsEventTypeList.SCROLL_BOTTOM_EVENT);
      else void showRecent(ev.shiftKey ? recentPlaces.length - 1 : 1);
      return true;
    // Ctrl+E: the same recent list without holding Ctrl (j/k or arrows move, Enter opens).
    case 'e': void showRecent(1); return true;
    case 'f': startFind(); return true;
    case '1': case '2': case '3': {
      const module = (['coding', 'email', 'chat'] as const)[Number(key) - 1];
      if (modules.includes(module)) void choosePhoneModule(module);
      return true;
    }
    case 'Home': case 'End':
      if (reader) {
        const offset = reader.pageTarget ?? reader.offset ?? 0;
        const delta = key === 'Home' ? -offset : readerLayout(reader).length - 1 - offset;
        if (delta) flipReader(reader, delta);
      }
      return true;
    case 'r':
      if (reader) void refreshReader(reader);
      else if (s.kind === 'list' && s.module) s.menuActions?.find(action => action.id === 1001)?.run();
      return true;
    case 'n':
      if (activeModule === 'coding' && orcaAvailable) { enterPage('newSession'); void newSession(); }
      else if (activeModule === 'email') void startMailDraft('new');
      return true;
  }
  return false;
}

// Ctrl+, (Eugene, 2026-11-27: "so it's similar to typical IDEs like VS Code"): the actions of the
// glasses' long-press menu for this screen (reader: Font, Background, App Brightness; home lists:
// Refresh, New Session, Usage) as a list on the glasses. The firmware popup itself cannot be opened
// by an app (SDK 0.0.16), and its system rows (Display off, Brightness, Close) are not listed here.
// Esc/double-click returns to the screen. A page an action opens (Font, Background, App Brightness,
// New Session, Usage) goes back to this list, one layer at a time (Eugene, 2026-11-27), with the
// cursor on that action.
function showActionMenu(origin: Screen | null = current, selected = 0) {
  const s = origin;
  if (!s || composing || (s.kind === 'list' && s.textPicker) || (s.kind === 'text' && s.voice)) return;
  // A reader's labels name the current font and background: rebuild them, a page may have changed one.
  if (s.kind === 'text' && s.reader) s.menuActions = readerMenu(s);
  const actions = s.menuActions ?? [];
  if (!actions.length) return;
  const back = () => s.kind === 'list' && s.module ? showModule() : show(s);
  if (s.kind === 'text') s.reading = true;
  let picked = false;
  const at = Math.max(0, Math.min(selected, actions.length - 1));
  return show({
    kind: 'list', textPicker: true, title: ' ', items: actions.map(action => action.label), selected: at, paintedSelection: at,
    // The action opens its own page straight from this list (G2 1.0.82: going back first flashed
    // the screen behind it). An action that opens nothing (Translate, Refresh) returns to the screen.
    onPick: i => {
      if (picked || !actions[i]) return;
      picked = true;
      if (s.kind === 'text') s.reading = false;
      const list = current;
      void Promise.resolve(actions[i].run(() => showActionMenu(s, i))).then(() => { if (current === list) return back(); }).catch(e => diag((e as Error).message));
    },
    onBack: () => { if (s.kind === 'text') s.reading = false; void back(); },
  });
}


// ?: the keys on the glasses; any key or gesture back returns (to the command palette when it
// opened the page: `up`).
function showKeys(up?: Up) {
  const back = current;
  if (!back || composing || (back.kind === 'text' && back.voice)) return;
  if (back.kind === 'text') back.reading = true;
  const leave = () => {
    if (up) { void Promise.resolve(up()).catch(e => diag((e as Error).message)); return; }
    if (back.kind === 'list' && back.module) { void showModule(); return; }
    if (back.kind === 'text') Object.assign(back, { reading: false });
    void show(back).catch(e => diag((e as Error).message));
  };
  void show({ kind: 'text', title: ' ', text: '', fine: smallFont, keysPage: true, onBack: leave, onClick: leave });
}

// The Gmail key map outside text boxes. Returns true when the key was used.
// Arrow and paging keys by every name a WebView may report (Eugene on G2, 2026-11-27: Up/Down did
// nothing on the home list while j/k worked): the standard key, the old 'Up'/'Down' names, the
// physical code, or only the legacy keyCode.
const KEY_CODES: Record<number, string> = { 33: 'PageUp', 34: 'PageDown', 37: 'ArrowLeft', 38: 'ArrowUp', 39: 'ArrowRight', 40: 'ArrowDown' };
const OLD_NAMES: Record<string, string> = { Up: 'ArrowUp', Down: 'ArrowDown', Left: 'ArrowLeft', Right: 'ArrowRight' };
function keyName(ev: KeyboardEvent): string {
  const key = ev.key;
  if (key && key !== 'Unidentified') return OLD_NAMES[key] ?? key;
  if (/^(?:Arrow(?:Up|Down|Left|Right)|Page(?:Up|Down))$/.test(ev.code ?? '')) return ev.code;
  return KEY_CODES[ev.keyCode] ?? key ?? '';
}
const ARROWS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown']);

function gmailKey(ev: KeyboardEvent, s: Screen, glassEvent: (type: OsEventTypeList) => void): boolean {
  const key = keyName(ev);
  if (key === 'n' && s.kind === 'text' && s.imageView?.image && s.imageView.mode !== 'outline') {
    const view = s.imageView;
    view.invert = !(view.invert ?? view.image!.negative ?? view.image!.mean > 0.6);
    // The bridge redraws it (edges are found after the negative); an older bridge: the app inverts.
    if (view.image!.negative === undefined) void repaintImage(s);
    else { view.image = undefined; void loadImage(s); }
    return true;
  }
  const list = s.kind === 'list' ? s : null;
  const moduleList = list?.module ? list : null;
  const reader = s.kind === 'text' && s.reader && !s.voice && !s.comparison ? s : null;
  switch (key) {
    // Up/Down move one row on a list and one page in a reader (like Shift+Space / Space);
    // Left/Right and PageUp/PageDown turn reader pages too.
    case 'ArrowUp': glassEvent(OsEventTypeList.SCROLL_TOP_EVENT); return true;
    case 'ArrowDown': glassEvent(OsEventTypeList.SCROLL_BOTTOM_EVENT); return true;
    case 'ArrowLeft': case 'PageUp': if (reader) flipReader(reader, -1); else glassEvent(OsEventTypeList.SCROLL_TOP_EVENT); return true;
    case 'ArrowRight': case 'PageDown': if (reader) flipReader(reader, 1); else glassEvent(OsEventTypeList.SCROLL_BOTTOM_EVENT); return true;
    case 'j': case 'k':
      if (reader) openNeighbor(key === 'j' ? 1 : -1);
      else glassEvent(key === 'j' ? OsEventTypeList.SCROLL_BOTTOM_EVENT : OsEventTypeList.SCROLL_TOP_EVENT);
      return true;
    case 'Enter': case 'o': glassEvent(OsEventTypeList.CLICK_EVENT); return true;
    // Back. A module list has no back, and the keyboard never closes the app.
    case 'Escape': case 'Backspace': case 'u':
      if (!moduleList) glassEvent(OsEventTypeList.DOUBLE_CLICK_EVENT);
      return true;
    case ' ':
      if (reader) flipReader(reader, ev.shiftKey ? -1 : 1);
      return true;
    case 'Tab':
      if (moduleList && !modulePending) cycleModule(moduleList);
      return true;
    case '?': showKeys(); return true;
  }
  const email = activeModule === 'email' && (!!moduleList || !!reader?.reader?.mail);
  if (!email) {
    if (key === 'r' && reader && replyTarget && !replyTarget.readOnly) { void startReplyDraft(); return true; }
    return false;
  }
  if (key === 'c') { void startMailDraft('new'); return true; }
  if (key === 'z') { void mailUndo(); return true; }
  const thread = reader ? reader.reader!.mail : moduleList ? selectedMailThread(moduleList) : undefined;
  if (!thread) return false;
  const actions: Record<string, () => unknown> = {
    r: () => startMailDraft('reply', thread), a: () => startMailDraft('replyAll', thread), f: () => startMailDraft('forward', thread),
    e: () => mailAction(thread, 'archive'), '#': () => mailAction(thread, 'trash'),
    U: () => mailAction(thread, 'unread'), I: () => mailAction(thread, 'read'),
    s: () => mailAction(thread, thread.starred ? 'unstar' : 'star'),
  };
  if (!Object.hasOwn(actions, key)) return false;
  void actions[key]();
  return true;
}

async function repaintChat(screen: TextScreen, position: 'page' | 'line' = 'page') {
  if (current === screen) await updateText(screen.title, screen.text, screen.openingOffset, position);
}

async function translateChat(screen: TextScreen, source: ChatReader) {
  if (await source.translate()) await repaintChat(screen, 'line').catch(() => {});
}

async function setChatTranslation(enabled: boolean) {
  chatTranslate = enabled;
  chatTranslateWrites = chatTranslateWrites.then(async () => { await bridge.setLocalStorage(CHAT_TRANSLATE_KEY, enabled ? 'en' : 'off'); })
    .catch(() => {});
  phone?.render();
  const screen = current;
  if (screen?.kind === 'text' && screen.reader instanceof ChatReader) {
    const source = screen.reader;
    await readerWrites;
    if (current === screen && enabled === chatTranslate) {
      const next = { ...screen, ...source.content() };
      keepReaderLine(screen, next);
      Object.assign(screen, next);
      await show(screen);
      if (enabled && current === screen) void translateChat(screen, source);
    }
  }
  await chatTranslateWrites;
}

// Restart live updates without rebuilding the mounted chat after a successful send.
function startReaderUpdates(screen: Screen | null): (() => Promise<void>) | undefined {
  clearInterval(poll);
  clearInterval(statusAnimation);
  if (screen?.kind !== 'text' || !screen.reader?.coding) return;
  const t = screen.reader.coding;
  screen.statusStartedAt ??= Date.now();
  let animating = false;
  statusAnimation = setInterval(async () => {
    if (animating || current !== screen || screen.activityState !== 'working') return;
    animating = true;
    const label = readerStatus('working', screen.statusFrame = (screen.statusFrame || 0) + 1, Date.now() - screen.statusStartedAt!);
    try {
      const accepted = await writePanel(label, () => current === screen && screen.activityState === 'working');
      if (accepted && current === screen) screen.activityLabel = label;
    } catch (e) { diag((e as Error).message); }
    finally { animating = false; }
  }, screen.fine ? 1000 : 200);
  let reading = false;
  const tick = async () => {
    if (reading || current !== screen) return;
    reading = true;
    const activity = await api.activity(t.handle).catch(e => {
      diag(`Activity request failed: ${(e as Error).message}`);
      return { state: 'unknown', elapsedSeconds: null };
    });
    if (current !== screen) { reading = false; return; }
    if (screen.activityState !== activity.state) { screen.statusFrame = 0; screen.statusStartedAt = Date.now(); }
    screen.activityState = activity.state;
    const seconds = activity.state === 'working' ? activity.elapsedSeconds ?? null : null;
    const readOnlyChanged = 'readOnly' in activity && typeof activity.readOnly === 'boolean' && t.readOnly !== activity.readOnly;
    if (readOnlyChanged) {
      t.readOnly = activity.readOnly;
      selectThread(t);
    }
    if (screen.reportedSeconds !== seconds || readOnlyChanged) {
      screen.reportedSeconds = seconds;
      try { await inputHint(); } catch (e) { diag((e as Error).message); }
      if (current !== screen) { reading = false; return; }
    }
    const label = readerStatus(activity.state, screen.statusFrame || 0, Date.now() - screen.statusStartedAt!);
    if (screen.activityLabel !== label) {
      try {
        const accepted = await writePanel(label, () => current === screen);
        if (accepted && current === screen) screen.activityLabel = label;
      } catch (e) { diag((e as Error).message); }
    }
    if (current !== screen) { reading = false; return; }
    // Choice prompts live in the terminal UI, not saved chat. Check them even
    // when history is selected, without rebuilding or moving a paused reader.
    const snapshot = await api.thread(t.handle).catch(() => null);
    if (current !== screen) { reading = false; return; }
    if (snapshot && screen.choiceMenu?.id !== snapshot.menu?.id) {
      screen.choiceMenu = snapshot.menu;
      await inputHint().catch(e => diag((e as Error).message));
    }
    if (screen.reading) { reading = false; return; }
    let r = await (screen.savedHistory ? api.history(t.handle) : Promise.resolve(snapshot)).catch(() => null);
    if (screen.savedHistory && (!r || !('source' in r) || !['codex-transcript', 'claude-transcript', 'cursor-transcript', 'opencode-transcript', 'pi-transcript', 'hermes-transcript'].includes(r.source || ''))) {
      r = snapshot;
      // Stay on live output after losing the verified saved-history association.
      if (r && current === screen) screen.savedHistory = false;
    }
    // A pending old-session read must never overwrite another screen or draft.
    if (r && current === screen && !screen.reading) {
      // An empty live tool frame must not erase the last public reply.
      if (r.text.trim()) screen.conversationText = r.text;
      // A model switch mid-session updates the status row in place.
      const model = ('model' in r ? r.model : undefined) || snapshot?.model;
      if (model && model !== screen.model) {
        screen.model = model;
        // Native: the spinner image sits after the model name, and an image cannot
        // move without a rebuild. Small text redraws its status row.
        if (!screen.fine) { reading = false; await show(screen).catch(e => diag((e as Error).message)); return; }
        requestFineStatus(screen);
      }
      const text = readerContent(screen.conversationText || '', screen.choiceMenu, snapshot?.progress, t.agent === 'claude' && screen.activityState === 'working');
      if (text.trim() && text !== screen.text) {
        try { await updateText(screen.title, text); }
        catch (e) { diag((e as Error).message); }
      }
    }
    reading = false;
  };
  poll = setInterval(tick, POLL_MS);
  return tick;
}

function history(t: Thread) {
  const previous = current;
  return guard(t.title, async () => {
    const r = await api.history(t.handle);
    if (current !== previous) return;
    const title = ['codex-transcript', 'claude-transcript', 'cursor-transcript', 'opencode-transcript', 'pi-transcript', 'hermes-transcript'].includes(r.source || '') ? tr('conversationHistory') : tr('terminalOnly');
    const text = r.text || r.reason || tr('noOlderOutput');
    await show({ kind: 'text', title, text, tail: true, reader: { title, load: async () => ({ text }), coding: t, hold: () => { if (!t.readOnly) void record({ thread: t }, true); } },
      onBack: () => thread(t) });
  }, () => thread(t));
}

function replies(t: Thread) {
  return guard(t.title, async () => {
    const { menu } = await api.thread(t.handle);
    if (menu) {
      await show({
        kind: 'list', title: t.title,
        items: menu.options.map(o => `${o.value}. ${o.label}`),
        onPick: (i) => {
          const option = menu.options[i];
          if (!option) return;
          show({ kind: 'text', title: tr('chooseHint'),
            text: `${menu.question}\n\n${option.value}. ${option.label}${option.description ? '\n' + option.description : ''}`,
            onBack: () => replies(t),
            onClick: () => guard(t.title, async () => {
              if (sending) return;
              sending = true;
              try {
                await show({ kind: 'text', title: t.title, text: tr('sending') });
                const result = await api.choice(t.handle, menu.id, option.value);
                await thread(t, tr('inputSent', result.sent));
              } finally { sending = false; }
            }, () => thread(t)),
          });
        },
        onBack: () => thread(t),
      });
      return;
    }
    await thread(t);
  }, () => thread(t));
}

// Reuse upstream PCM and local Whisper. Snapshots are serialized and provisional;
// only the final text can be sent, once, to the captured terminal handle.
let recording: Uint8Array[] | null = null;
let cancelCapture: (() => void) | null = null;
const MAX_REC_SEC = 60;

// Voice hints on the full-screen voice page's instruction row.
const voiceReview = () => tr('voiceReview');
const voiceReturn = () => tr('voiceReturn');

type VoiceTarget = { thread: Thread } | { search: (text: string) => Promise<void> } |
  { reply: (text: string) => Promise<boolean>; onResult: (sent: boolean) => void };
async function record(target: VoiceTarget, hold = false) {
  if ((hold && !holding) || recording !== null || cancelCapture) return;
  diag('Hold received. Opening voice screen…');
  const background = current;
  const search = 'search' in target ? target.search : undefined;
  const voiceListening = () => tr(search ? 'voiceSearchListening' : 'voiceListening');
  if (search ? background?.kind !== 'list' || !background.mailPicker : background?.kind !== 'text' || !background.reader) return;
  if (!background) return;
  await (background.kind === 'text' ? readerWrites : sessionCursorWrites);
  if (current !== background || (hold && !holding)) return;
  const choiceMenu = background.kind === 'text' ? background.choiceMenu : undefined;
  // Hold opens a full-screen voice page that is already listening. Send or
  // cancel rebuilds the chat at its newest (bottom) page.
  if (background.kind === 'text') background.reading = true;
  clearInterval(poll);
  clearInterval(statusAnimation);
  let overlayActive = true;
  let voiceWrites: Promise<void> = Promise.resolve();
  const voiceScreen: TextScreen = { kind: 'text', title: ' ', text: ' ', voice: true, voiceHint: voiceListening(), voiceTail: true };
  // Serialize page and row writes; the first call builds the voice page and
  // later calls replace only its transcript and instruction rows.
  const voiceShow = (text: string, hint: string, handlers: { onClick?: () => void; onBack?: () => void } = {}, tail = false) => {
    const write = voiceWrites.then(async () => {
      if (!overlayActive) return;
      const before = { text: voiceScreen.text, hint: voiceScreen.voiceHint, tail: voiceScreen.voiceTail };
      Object.assign(voiceScreen, { text: text || ' ', voiceHint: hint, voiceTail: tail, onClick: handlers.onClick, onBack: handlers.onBack });
      if (current !== voiceScreen) { await show(voiceScreen); return; }
      if (before.text !== voiceScreen.text || before.tail !== voiceScreen.voiceTail) {
        if (!await bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: VOICE_BODY.containerID, containerName: VOICE_BODY.containerName, content: voiceBodyText(voiceScreen) })))
          throw new Error('Glasses rejected the voice text update.');
      }
      if (before.hint !== hint && !await bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: VOICE_HINT.containerID, containerName: VOICE_HINT.containerName, content: hint || ' ', textColor: textBrightness() })))
        throw new Error('Glasses rejected the voice instruction update.');
    });
    voiceWrites = write.catch(() => {});
    return write;
  };
  // Return to the chat at its newest page (not the latest-response page).
  const closeVoice = async () => {
    if (!overlayActive) return;
    overlayActive = false;
    await voiceWrites;
    if (current !== voiceScreen) return;
    if (background.kind === 'text') Object.assign(background, { reading: false, tail: true, offset: undefined, openAtResponse: false, pageTarget: undefined, pageWriting: false });
    try { await show(background); }
    catch (e) { diag((e as Error).message); void showModule(); }
  };
  recording = [];
  const chunks = recording;
  const t0 = Date.now();
  let stopped = false, cancelled = false, submitted = false;
  let tick: ReturnType<typeof setInterval> | undefined;
  let pending: Promise<void> | null = null;
  let lastBytes = 0, caption = '';
  const snapshot = () => {
    const pcm = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
    let offset = 0;
    for (const c of chunks) { pcm.set(c, offset); offset += c.length; }
    return pcm;
  };
  const cleanup = () => {
    clearInterval(tick);
    recording = null;
    releaseCapture = null;
  };
  const cancel = () => {
    cancelled = true;
    stopped = true;
    cleanup();
    cancelCapture = null;
    void bridge.audioControl(false).catch(() => {});
  };
  cancelCapture = cancel;
  const back = () => { cancel(); void closeVoice(); };
  const sendText = async (text: string, shown: string) => {
    if (cancelled || submitted || sending || 'search' in target) return;
    submitted = true;
    sending = true;
    cancelCapture = null;
    try {
      await voiceShow(shown, tr('sending'));
      if ('reply' in target) {
        target.onResult(await target.reply(text).catch(() => false));
        if (background.kind === 'text') background.activityLabel = background.reader?.statusText?.();
      } else if (choiceMenu) {
        const value = choiceNumber(text);
        if (!value || !choiceMenu.options.some(o => o.value === value)) throw new Error(tr('sayOptionNumber'));
        await api.choice(target.thread.handle, choiceMenu.id, value);
      } else await api.say(target.thread.handle, text);
      await closeVoice();
      if ('reply' in target && background.kind === 'text' && current === background) void refreshReader(background);
    } catch (e) {
      await voiceShow((e as Error).message, voiceReturn(), { onBack: () => { void closeVoice(); }, onClick: () => { void closeVoice(); } }).catch(e => diag((e as Error).message));
    } finally { sending = false; }
  };
  const stop = async (finish: boolean) => {
    if (stopped) return;
    if (!finish) { back(); return; }
    stopped = true;
    cleanup();
    await bridge.audioControl(false).catch(() => {});
    try {
      await voiceShow(caption || tr('finishingTranscription'), tr('transcribing'), { onBack: back }, true);
      await pending;
      if (cancelled) return;
      const pcm = snapshot();
      const text = pcm.length === lastBytes ? caption : (await api.transcribe(pcm)).text.trim();
      if (cancelled) return;
      cancelCapture = null;
      if (!text) {
        await voiceShow(tr('notHeard'), voiceReturn(), { onClick: () => { void closeVoice(); }, onBack: () => { void closeVoice(); } });
      } else if (search) {
        if (current === voiceScreen) await search(text);
        overlayActive = false;
      } else {
        cancelCapture = cancel;
        const choice = choiceMenu?.options.find(o => o.value === choiceNumber(text));
        const shown = choice ? `${choice.value}. ${choice.label}` : text;
        await voiceShow(shown, voiceReview(), { onClick: () => { void sendText(text, shown); }, onBack: back });
      }
    } catch (e) {
      if (cancelled) return;
      cancelCapture = null;
      await voiceShow((e as Error).message, voiceReturn(), { onBack: () => { void closeVoice(); }, onClick: () => { void closeVoice(); } }).catch(e => diag((e as Error).message));
    }
  };
  if (hold) releaseCapture = () => { void stop(true); };
  try {
    await voiceShow(hold ? ' ' : tr('recordingHint'), voiceListening(), { onClick: hold ? undefined : () => { void stop(true); }, onBack: () => { void stop(false); } }, true);
  } catch (e) {
    // The voice page was rejected: the chat is still mounted, so resume it.
    cancel();
    overlayActive = false;
    current = background;
    if (background.kind === 'text') { background.reading = false; startReaderUpdates(background); }
    diag((e as Error).message);
    return;
  }
  if (stopped) return;
  const ok = await bridge.audioControl(true, AudioInputSource.Glasses).catch(() => false);
  if (stopped) { await bridge.audioControl(false); return; }
  if (!ok) {
    cancel();
    await voiceShow(tr('micFailed'), voiceReturn(), { onClick: () => { void closeVoice(); }, onBack: () => { void closeVoice(); } });
    return;
  }
  diag('Recording — full-screen voice page.');
  tick = setInterval(() => {
    if (stopped) return;
    const sec = Math.floor((Date.now() - t0) / 1000);
    if (sec >= MAX_REC_SEC) { void stop(true); return; }
    if (pending) return; // No overlapping inference or growing request queue.
    const pcm = snapshot();
    if (pcm.length < 16000 || pcm.length === lastBytes) return;
    pending = (async () => {
      try {
        const result = await api.transcribe(pcm);
        if (cancelled) return;
        lastBytes = pcm.length;
        caption = result.text.trim();
        if (!stopped && caption) await voiceShow(caption, voiceListening(), { onBack: () => { void stop(false); } }, true);
      } catch { /* Final transcription reports errors; transient preview failure is not a send. */ }
      finally { pending = null; }
    })();
  }, 1500);
}

// The Usage page as bars: one group per provider, one bar per window (5h, week, month).
function usagePage(u: Usage, mode: ResetMode): UsagePage {
  const all = Object.entries(u).filter(([, v]) => v && typeof v === 'object' && 'provider' in v);
  const ok = all.filter(([, v]) => v.status === 'ok');
  const ng = all.filter(([, v]) => v.status !== 'ok').map(([name]) => name);
  const groups = ok.map(([name, v]) => ({ name: providerName(v.provider || name), bars: ([
    ['5h', v.session], [tr('weekly'), v.weekly], [tr('monthly'), v.monthly],
  ] as const).filter(([, limit]) => !!limit).map(([label, limit]) => ({ label, percent: limit!.usedPercent, reset: formatReset(limit!, mode) })) }));
  return { title: tr('usageTitle'), reset: tr('resetLine', resetModeLabel(mode)), groups,
    note: ng.length ? tr('unavailable', ng.join(', ')) : '', none: tr('noInfo') };
}

// Back: home, or the menu that opened it (pageUp.usage; kept while a reset-mode change redraws it).
function usage() {
  const leave = () => { void leavePage('usage', home); };
  return guard(tr('usageTitle'), async () => {
    const u = await api.usage();
    let writing = false;
    const screen: Extract<Screen, { kind: 'text' }> = { kind: 'text', title: tr('usageTitle'), text: '',
      fine: smallFont, usagePage: usagePage(u, usageResetMode), onBack: leave,
      onClick: () => { void update(true); } };
    const update = async (cycle = false) => {
      if (current !== screen || writing || (!cycle && screen.reading)) return;
      writing = true;
      try {
        if (cycle) {
          const next = RESET_MODES[(RESET_MODES.indexOf(usageResetMode) + 1) % RESET_MODES.length];
          await bridge.setLocalStorage('usage-reset-mode', next);
          usageResetMode = next;
          phone?.render();
        }
        if (current !== screen) return;
        // Redraw the page; paintFine sends only the tiles that changed (the reset row, the times).
        screen.usagePage = usagePage(u, usageResetMode);
        await paintFine(screen, 0);
      } catch (e) { diag((e as Error).message); }
      finally { writing = false; }
    };
    await show(screen);
    if (current === screen) poll = setInterval(() => {
      if (usageResetMode === 'absolute') void update();
    }, 60000);
  }, leave);
}

// 新規セッション: 作業場所 → エージェント → モデル → 最初の指示 → 確認
// Each step goes back one step; the first goes home, or to the menu that opened it
// (pageUp.newSession, kept while the later steps come back to this one).
function newSession() {
  const leave = () => { void leavePage('newSession', home); };
  return guard(tr('newTitle'), async () => {
    const ws = await api.workspaces();
    await show({
      kind: 'list',
      title: tr('step1'),
      items: ws.map((w) => w.name),
      onPick: (i) => ws[i] && pickAgent(ws[i]),
      onBack: leave,
    });
  }, leave);
}

function pickAgent(w: Workspace) {
  return guard(tr('newTitle'), async () => {
    const ps = await api.providers();
    await show({
      kind: 'list',
      title: tr('step2', w.name),
      items: ps.map((p) => `${p.ok ? '○' : '×'} ${p.id}  ${p.note}`),
      onPick: (i) => ps[i]?.ok && pickModel(w, ps[i]),
      onBack: newSession,
    });
  }, newSession);
}

function pickModel(w: Workspace, p: Provider) {
  if (p.models.length === 1) return pickPrompt(w, p, p.models[0]);
  return show({
    kind: 'list',
    title: tr('step3', p.id),
    items: p.models,
    onPick: (i) => pickPrompt(w, p, p.models[i]),
    onBack: () => pickAgent(w),
  });
}

function pickPrompt(w: Workspace, p: Provider, model: string) {
  return guard(tr('newTitle'), async () => {
    const prompts = await api.prompts();
    await show({
      kind: 'list',
      title: tr('step4'),
      items: prompts,
      onPick: (i) => confirm(w, p, model, i, prompts[i]),
      onBack: () => pickModel(w, p),
    });
  }, () => pickModel(w, p));
}

function confirm(w: Workspace, p: Provider, model: string, prompt: number, label: string) {
  return show({
    kind: 'list',
    title: `${w.name} / ${p.id} ${model} / ${label}`,
    items: [tr('launch'), tr('cancel')],
    onPick: async (i) => {
      if (i !== 0) return home();
      await show({ kind: 'text', title: tr('launching'), text: tr('waitingAgent') });
      await guard(tr('newTitle'), async () => {
        const r = await api.startSession({ workspaceId: w.id, agent: p.id, model, prompt });
        const text = r.sent || !prompt ? tr('launched') : tr('launchedNotSent', r.reason ?? '');
        await show({ kind: 'text', title: tr('newTitle'), text, onClick: home, onBack: home });
      }, home);
    },
    onBack: () => pickPrompt(w, p, model),
  });
}

// ---- 入力 ----

// Keys reach this page only while its WebView has keyboard focus. Eugene, 2026-11-27: the keyboard
// "does not work right away", only after switching modules on the phone. The page takes the focus
// itself at start, when it is shown again, and on every glasses gesture, unless a text box has it.
// Android gives the keyboard to the Even app's page only after a tap on it, which the page cannot
// do for itself. The phone page's top button (1.0.84; Eugene: "one press wakes the keyboard ...
// better than toggling back and forth") is that tap. Its label follows what is seen, not
// document.hasFocus() (1.0.83's banner hid on hasFocus() and did not help on G2):
// off (amber) at start, armed after a press, working once a key event arrives; a blur or a hidden
// page turns it off again.
type KeyState = 'off' | 'armed' | 'working';
let keyState: KeyState = 'off';
function setKeyState(next: KeyState) {
  if (next === keyState) return;
  keyState = next;
  showKeyFocus();
}
function showKeyFocus() {
  const button = document.getElementById('key-focus');
  if (!button) return;
  button.setAttribute?.('data-state', keyState); // the CSS colours follow it
  button.textContent = tr(keyState === 'working' ? 'keyFocusWorking' : keyState === 'armed' ? 'keyFocusArmed' : 'keyFocusEnable');
}
function pressKeyButton() {
  // The tap has already given this page the keyboard. Move the DOM focus off the button to the body
  // (ensureKeyFocus), so Enter or Space reaches the glasses handlers instead of pressing it again.
  (document.activeElement as HTMLElement | null)?.blur?.();
  ensureKeyFocus();
  diag('Keyboard: button pressed');
  setKeyState('armed');
}

function ensureKeyFocus() {
  const active = document.activeElement as HTMLElement | null;
  if (active && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName)) return;
  try {
    const body = document.body as HTMLElement | null;
    if (body && body.tabIndex < 0 && !body.hasAttribute?.('tabindex')) body.setAttribute('tabindex', '-1');
    window.focus?.();
    body?.focus?.({ preventScroll: true });
  } catch { /* A host without focus control: keys still arrive once the user taps the page. */ }
}

function onEvent(e: EvenHubEvent) {
  if (!e.audioEvent) ensureKeyFocus();
  if (e.menuItemClickEvent) {
    const screen = current;
    if (screen?.kind === 'list' && screen.module && !modulePending) {
      const action = screen.menuActions?.find(a => a.id === e.menuItemClickEvent!.itemID);
      if (action) void sessionCursorWrites.then(() => { if (current === screen) action.run(); });
    } else if (screen?.kind === 'text' && screen.reader && !screen.voice) {
      const action = screen.menuActions?.find(a => a.id === e.menuItemClickEvent!.itemID);
      if (action) void readerWrites.then(() => { if (current === screen) return action.run(); }).catch(err => diag((err as Error).message));
    }
    return;
  }
  const systemType = e.sysEvent?.eventType;
  if (systemType === OsEventTypeList.SYSTEM_EXIT_EVENT || systemType === OsEventTypeList.ABNORMAL_EXIT_EVENT) {
    cancelModuleSwitch();
    clearInterval(poll);
    clearInterval(statusAnimation);
    clearInterval(menuAnimation);
    clearInterval(menuPoll);
    current = null;
    cancelCapture?.();
    return;
  }
  if (e.audioEvent) {
    recording?.push(e.audioEvent.audioPcm);
    return;
  }
  const s = current;
  if (!s) return;
  // Press/release are system events even when another envelope accompanies them.
  const ev = [e.sysEvent, e.textEvent, e.listEvent].find(event =>
    event && [OsEventTypeList.LONG_PRESS_EVENT, OsEventTypeList.LONG_PRESS_RELEASE_EVENT].includes(event.eventType as OsEventTypeList))
    ?? e.listEvent ?? e.textEvent ?? e.sysEvent;
  if (!ev) return;
  // CLICK_EVENT(0) は既定値のため JSON から省かれて届くことがある
  const type = ev.eventType ?? OsEventTypeList.CLICK_EVENT;
  // Finish old-page cursor writes before reusing the same native containers.
  // Ignore repeated swipes/clicks during a fetch so one edge gesture changes
  // exactly one page and cannot activate a row from the page being replaced.
  if (s.kind === 'list' && s.paging) return;
  if (s.kind === 'list' && (s.module || s.workspacePicker || s.agentPicker || s.textPicker) && (type === OsEventTypeList.SCROLL_TOP_EVENT || type === OsEventTypeList.SCROLL_BOTTOM_EVENT)) {
    if (s.module && modulePending) return;
    const step = type === OsEventTypeList.SCROLL_TOP_EVENT ? -1 : 1;
    let next = (s.selected || 0) + step;
    while (s.headings?.includes(next)) next += step; // Headings are not selectable.
    const changePage = next < 0 ? s.onPreviousPage : next >= s.items.length ? s.onNextPage : undefined;
    if (changePage) {
      s.paging = true;
      void sessionCursorWrites.then(() => { if (current === s) return changePage(); })
        .catch(e => diag((e as Error).message)).finally(() => { s.paging = false; });
      return;
    }
    s.selected = Math.max(0, Math.min(s.items.length - 1, next));
    if (s.module) positions[s.module].cursor = s.selected;
    if (!s.cursorWriting) sessionCursorWrites = updateSessionCursor(s);
    return;
  }
  if (s.kind === 'text' && (type === OsEventTypeList.SCROLL_TOP_EVENT || type === OsEventTypeList.SCROLL_BOTTOM_EVENT)) {
    if (s.imageView) moveImage(s, type === OsEventTypeList.SCROLL_TOP_EVENT ? -1 : 1);
    else if (s.comparison) moveComparison(s, type === OsEventTypeList.SCROLL_TOP_EVENT ? -1 : 1);
    else if (s.reader) flipReader(s, type === OsEventTypeList.SCROLL_TOP_EVENT ? -1 : 1);
    else s.reading = true;
    return;
  }
  if (type === OsEventTypeList.LONG_PRESS_EVENT) {
    diag(holding ? 'Hold received; waiting for button release.' : 'Hold event received.');
    if (!holding) {
      holding = true;
      if (s.kind === 'text') s.reader?.hold?.();
      else s.onHold?.();
    }
    return;
  }
  if (type === OsEventTypeList.LONG_PRESS_RELEASE_EVENT) {
    holding = false;
    releaseCapture?.();
    return;
  }
  if (type === OsEventTypeList.DOUBLE_CLICK_EVENT) {
    if (s.onBack) s.onBack();
    else { cancelModuleSwitch(); bridge.shutDownPageContainer(1); }
    return;
  }
  if (type !== OsEventTypeList.CLICK_EVENT) return;
  if (s.kind === 'list') {
    // 先頭項目(0)も既定値として省かれうる
    if (s.module || s.workspacePicker || s.agentPicker || s.textPicker) {
      const index = e.listEvent?.currentSelectItemIndex ?? s.selected ?? 0;
      if (s.module && index === 0) { cycleModule(s); return; }
      // The opened row is the list position: back returns to it and j/k in the reader move from it.
      if (s.module) positions[s.module].cursor = index;
      // Finish in-flight cursor writes before reusing BODY on the next page.
      void sessionCursorWrites.then(() => { if (current === s) s.onPick(index); });
    }
    else if (e.listEvent) s.onPick(e.listEvent.currentSelectItemIndex ?? 0);
  } else {
    s.onClick?.();
  }
}

// ---- 接続設定(スマホ側の画面) ----

const $ = (id: string) => document.getElementById(id) as HTMLInputElement;

function diag(line: string) {
  $('diag').textContent = line;
}

async function connect() {
  cancelModuleSwitch();
  moduleCache.clear();
  const code = await bridge.getLocalStorage('code');
  const pairing = parseCode(code);
  $('code').value = code;
  const t0 = Date.now();
  setDemo(code === 'demo');
  demoConnection = code === 'demo';
  if (code === 'demo') {
    diag(tr('diagOk', 0, tr('viaDemo'), '-', 3));
    return openSavedOrHome({ state: 'demo' });
  }
  if (!pairing) {
    diag(tr('notPairedDiag'));
    phone?.connection({ state: 'unpaired' });
    return show({ kind: 'text', title: 'HUD Desk', text: tr('notPaired') });
  }
  phone?.connection({ state: 'connecting' });
  try {
    const base = await resolveBase(pairing);
    if (!base) throw new Error(tr('noRelay'));
    setConnection({ token: pairing.token, base, resolve: () => resolveBase(pairing) });
    await api.health();
    const threads = await api.threads();
    const ms = Date.now() - t0;
    diag(tr('diagOk', ms, tr('viaCode'), currentBase(), threads.length));
    return openSavedOrHome({ state: 'connected', ms }, threads);
  } catch (e) {
    diag(tr('diagNg', (e as Error).message, tr('viaCode'), currentBase()));
    phone?.connection({ state: 'offline', error: (e as Error).message });
    return show({
      kind: 'text',
      title: tr('offlineTitle'),
      text: tr('offline', (e as Error).message),
      onClick: () => connect(),
    });
  }
}

// Workout Glass keeps its countdown across screen-off by restoring the saved run
// when Even recreates the page. Do the same for the chat that was open.
async function openSavedOrHome(connection: Connection, known?: Thread[]) {
  const capabilities = await api.capabilities().catch(() => null);
  voiceAvailable = capabilities?.voice === true;
  modules = offeredModules(capabilities?.modules);
  applyCapabilities(capabilities);
  const stored = await bridge.getLocalStorage('module') as GlassModule;
  activeModule = modules.includes(stored) ? stored : 'coding';
  mail = new Mail(await bridge.getLocalStorage(MAIL_LABELS_KEY), await bridge.getLocalStorage(MAIL_ACCOUNTS_KEY), saveMailPref);
  chat = new Chat(await bridge.getLocalStorage(CHAT_NETWORKS_KEY));
  if (modules.includes('email') && !demoConnection) scheduleMailPreload(MAIL_PRELOAD_FIRST_MS);
  chatTranslate = await bridge.getLocalStorage(CHAT_TRANSLATE_KEY) === 'en';
  phone?.connection(connection);
  if (activeModule === 'email') return mailHome();
  if (activeModule === 'chat') return chatHome();
  const handle = await bridge.getLocalStorage('open-thread');
  if (handle) {
    const list = known ?? await api.threads().catch(() => []);
    const t = list.find(row => row.handle === handle);
    if (t) return thread(t);
    await bridge.setLocalStorage('open-thread', '');
  }
  return home();
}

function useLang(pref: string) {
  const l = detectLang(pref);
  setLang(l);
  setApiLang(l);
  applyPage();
  showKeyFocus(); // its label is not a data-i18n text
}

// Phone Settings language change: redraw the glasses screen that shows
// dictionary text. Voice pages and one-off messages keep their text until closed.
function redrawForLanguage() {
  moduleCache.clear();
  const s = current;
  if (!s) return;
  if (s.kind === 'list' && s.module) { if (!modulePending) void showModule(); return; }
  if (s.kind === 'list' && s.mailPicker) { void mailLabels(s.mailPicker.page, s.selected ?? 0, false, s.mailPicker.search); return; }
  if (s.kind === 'list' && s.chatPicker) { void chatNetworks(s.chatPicker.page, s.selected, s.chatPicker.networks); return; }
  if (s.kind === 'list' && (s.workspacePicker || s.agentPicker)) { refreshGlasses(); return; }
  if (s.kind === 'text' && s.usagePage) { void usage(); return; }
  if (s.kind === 'text' && s.reader && !s.voice) {
    s.activityLabel = s.reader.statusText?.() ?? readerStatus(s.activityState || 'unknown', s.statusFrame || 0, Date.now() - (s.statusStartedAt ?? Date.now()));
    s.fineLabel = undefined;
    void show(s).catch(e => diag((e as Error).message));
  }
}

async function main() {
  document.getElementById('app-heading')!.textContent = sessionHeading();
  bridge = await waitForEvenAppBridge();
  // 開発用URLからも接続コードと言語だけを読み込む
  const q = new URLSearchParams(location.search);
  for (const k of ['code']) {
    // Accept escaped QR query keys; language is fixed to English.
    const v = q.get(k) ?? q.get(`amp;${k}`);
    if (v != null) await bridge.setLocalStorage(k, v);
  }
  const pref = (await bridge.getLocalStorage('lang')) || 'en';
  viewProvider = (await bridge.getLocalStorage('view-provider')) || 'all';
  const savedText = await bridge.getLocalStorage('reader-text');
  if (FINE_FONTS.includes(savedText as FineFont)) readerText = savedText as FineFont;
  else if (REMOVED_FONTS.includes(savedText)) readerText = DEFAULT_SMALL_FONT;
  const savedFont = await bridge.getLocalStorage('reader-font');
  smallFont = FINE_FONTS.includes(savedFont as FineFont) ? savedFont as FineFont : readerText === 'native' ? DEFAULT_SMALL_FONT : readerText;
  turnBackground = parseTurnBackground(await bridge.getLocalStorage('reader-turn-bg'));
  turnHalo = await bridge.getLocalStorage(HALO_KEY) !== 'off'; // no saved choice = on
  inkLevel = parseInk(await bridge.getLocalStorage('reader-ink'));
  const resetMode = await bridge.getLocalStorage('usage-reset-mode');
  if (RESET_MODES.includes(resetMode as ResetMode)) usageResetMode = resetMode as ResetMode;
  for (const [key, set] of [['view-workspaces', (v: Set<string>) => { viewWorkspaces = v; }], ['view-hermes-workspaces', (v: Set<string>) => { viewHermesWorkspaces = v; }]] as const) {
    try {
      const stored = JSON.parse(await bridge.getLocalStorage(key) || 'null');
      if (Array.isArray(stored) && stored.every(id => typeof id === 'string')) set(new Set(stored));
    } catch { /* Older or corrupt preferences safely restore all workspaces. */ }
  }
  useLang(pref);
  phone = createPhone({
    modules: () => ({ offered: modules, selected: activeModule }),
    setModule: choosePhoneModule,
    mailLabels: () => mail?.labelGroups(true) ?? Promise.resolve([]),
    selectedMailLabels: () => mail?.selectedLabels() ?? new Set(),
    toggleMailLabel: key => toggleMailLabel(key, true),
    mailAccount: () => mail?.currentMailbox(),
    selectMailAccount: id => selectMailAccount(id),
    chatNetworks: () => chat?.networks() ?? Promise.resolve([]),
    chatNetworkSelected: name => chat?.isSelected(name) ?? false,
    toggleChatNetwork: (name, networks) => toggleChatNetwork(name, networks, true),
    chatTranslate: () => chatTranslate,
    chatTranslateAvailable: () => chatFeatures.translate,
    setChatTranslation,
    filters: () => ({ provider: viewProvider, orca: viewWorkspaces, hermes: viewHermesWorkspaces }),
    setProvider: async id => { await bridge.setLocalStorage('view-provider', id); viewProvider = id; refreshGlasses(); },
    setWorkspaces: async (hermes, value) => {
      if (hermes) viewHermesWorkspaces = value; else viewWorkspaces = value;
      await saveWorkspaces(hermes, value);
      refreshGlasses();
    },
    resetMode: () => usageResetMode,
    setResetMode: async mode => {
      await bridge.setLocalStorage('usage-reset-mode', mode);
      usageResetMode = mode;
      if (current?.kind === 'text' && current.usagePage) void usage();
    },
    agentName: providerName,
  });
  const langSelect = document.getElementById('lang') as HTMLSelectElement;
  langSelect.value = getLang();
  langSelect.addEventListener('change', async () => {
    const next = detectLang(langSelect.value);
    await bridge.setLocalStorage('lang', next);
    useLang(next);
    phone?.retranslate();
    redrawForLanguage();
  });
  const draft = document.getElementById('reply-text') as HTMLTextAreaElement;
  const send = document.getElementById('send-reply') as HTMLButtonElement;
  const status = document.getElementById('reply-status')!;
  let reviewed: { key: string; text: string } | null = null;
  const draftChanged = () => { reviewed = null; send.hidden = true; };
  draft.addEventListener('input', draftChanged);
  // Review first, send second: the same two steps whether tapped or typed (Enter, Enter).
  const reviewDraft = () => {
    if (!replyTarget || replyTarget.readOnly || sending || !draft.value.trim()) return;
    reviewed = { key: replyTarget.key, text: draft.value.trim() };
    status.textContent = tr('readyToSend', replyTarget.label, reviewed.text);
    send.hidden = false;
  };
  const sendDraft = async () => {
    const target = replyTarget;
    if (sending || !target || target.readOnly || !reviewed || reviewed.key !== target.key || reviewed.text !== draft.value.trim()) return;
    const message = reviewed;
    reviewed = null;
    sending = true;
    send.hidden = true;
    status.textContent = tr('sending');
    try {
      await target.send(message.text);
      if (replyTarget?.key === message.key) {
        draft.value = '';
        status.textContent = tr('sentDone');
      }
    } catch (e) {
      if (replyTarget?.key === message.key) status.textContent = (e as Error).message;
    } finally { sending = false; }
  };
  document.getElementById('reply-form')!.addEventListener('submit', ev => { ev.preventDefault(); reviewDraft(); });
  send.addEventListener('click', () => { void sendDraft(); });
  // Bluetooth keyboard paired with the phone (Eugene, 2026-11-27). Keys reach this page only while
  // it is open in the Even app. Gmail's PC shortcuts drive the glasses (gmailKey above); a draft
  // open on the glasses takes Enter/Ctrl+Enter/Esc; the label picker takes letters as a search.
  // In the phone's reply box tapped by hand (no draft on the glasses), Enter reviews then sends
  // as before. Space pages like Gmail now; voice stays on the glasses' tap-and-hold.
  // Every box of a draft redraws the glasses as it changes, including cursor moves.
  for (const id of [...Object.values(COMPOSE_IDS), 'reply-text']) {
    const el = document.getElementById(id);
    for (const name of ['input', 'keyup', 'click', 'focus']) {
      el?.addEventListener(name, () => {
        const c = composing;
        if (!c) return;
        const field = composeFieldsOf(c.draft).find(key => fieldId(c.draft, key) === id);
        if (name === 'focus' && field && !c.review) c.focus = field;
        if (name === 'input') c.note = '';
        void renderCompose();
      });
    }
  }
  document.addEventListener?.('selectionchange', () => { if (composing && !composing.review) void renderCompose(); });
  // An arrow whose keydown never reached the page (the host app may take it for its own focus)
  // acts on its keyup instead; one that had a keydown does not act twice.
  const arrowsDown = new Set<string>();
  window.addEventListener('keyup', (ev: KeyboardEvent) => {
    setKeyState('working'); // a key reached the page: the phone button turns green
    const key = keyName(ev);
    if ((key === 'Control' || key === 'Meta') && switcher && current === switcher) { glassEvent(OsEventTypeList.CLICK_EVENT); return; }
    if (key === 'Tab' && switcher && current === switcher) {
      if (!tabDown) { diag('Key up only: Tab in Recent'); glassEvent(ev.shiftKey ? OsEventTypeList.SCROLL_TOP_EVENT : OsEventTypeList.SCROLL_BOTTOM_EVENT); }
      tabDown = false;
      return;
    }
    if (!ARROWS.has(key)) return;
    if (arrowsDown.delete(key)) return;
    diag(`Key up only: ${key} (${ev.code || '-'}/${ev.keyCode ?? '-'})`);
    const target = ev.target as HTMLElement | null;
    if (composing || (target && (['TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable === true ||
      (target.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit'].includes((target as HTMLInputElement).type))))) return;
    const s = current;
    if (s && !(ev.ctrlKey || ev.metaKey || ev.altKey) && gmailKey(ev, s, glassEvent)) ev.preventDefault();
  });
  window.addEventListener('keydown', (ev: KeyboardEvent) => {
    setKeyState('working');
    const target = ev.target as HTMLElement | null;
    const arrow = keyName(ev);
    if (ARROWS.has(arrow)) { arrowsDown.add(arrow); diag(`Key: ${arrow} (${ev.key || '-'}/${ev.code || '-'}/${ev.keyCode ?? '-'})`); }
    // Text boxes keep their keys; a checkbox, radio or button with the focus does not (a tapped
    // filter checkbox on the phone page must not swallow the arrows).
    const editing = !!target && (['TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable === true ||
      (target.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit'].includes((target as HTMLInputElement).type)));
    const c = composing;
    if (c) {
      const inDraft = editing && composeFieldsOf(c.draft).some(field => fieldId(c.draft, field) === target!.id);
      if (c.review) {
        if (ev.key === 'Enter') { ev.preventDefault(); void composeSend(); }
        else if (ev.key === 'Escape' || (!inDraft && ev.key === 'Backspace')) { ev.preventDefault(); composeEdit(); }
        else if (inDraft) ev.preventDefault(); // no edits while the glasses show the review
        return;
      }
      if (inDraft) {
        if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey || (!c.draft.mail && !ev.shiftKey))) { ev.preventDefault(); composeReview(); }
        else if (ev.key === 'Escape') { ev.preventDefault(); void closeCompose(); }
        return;
      }
      if (editing) return;
      // A draft is open but no box has the focus (a tap elsewhere on the phone page).
      if (ev.key === 'Enter') { ev.preventDefault(); composeEdit(); }
      else if (ev.key === 'Escape') { ev.preventDefault(); void closeCompose(); }
      return;
    }
    if (editing) {
      if (target!.id === 'reply-text' && ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        if (send.hidden) reviewDraft(); else void sendDraft();
      } else if (ev.key === 'Escape') { ev.preventDefault(); target!.blur?.(); }
      return;
    }
    // In the Ctrl+Tab list every Tab moves (G2 1.0.82: the list opened, later Tabs did not move).
    if (switcher && current === switcher && keyName(ev) === 'Tab') {
      ev.preventDefault();
      tabDown = true;
      diag(`Key: Tab in Recent${ev.ctrlKey ? ' (Ctrl)' : ''}`);
      glassEvent(ev.shiftKey ? OsEventTypeList.SCROLL_TOP_EVENT : OsEventTypeList.SCROLL_BOTTOM_EVENT);
      return;
    }
    if (ideKey(ev)) { ev.preventDefault(); return; }
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const s = current;
    if (!s) return;
    // Typing into a quick-open or command list, or a Ctrl+F query, before any other key use.
    if (finder && current === finder.screen && finderType(finder, ev.key)) { ev.preventDefault(); return; }
    if (finding && (current !== finding.screen)) finding = null;
    if (finding && findType(ev)) { ev.preventDefault(); return; }
    if (s.kind === 'list' && s.mailPicker && typeLabelSearch(ev.key, s.mailPicker.search)) { ev.preventDefault(); return; }
    if (gmailKey(ev, s, glassEvent)) ev.preventDefault();
  });
  $('conn').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    cancelCapture?.();
    holding = false;
    const code = $('code').value.trim();
    if (code && code !== 'demo' && !parseCode(code)) return diag(tr('badCode'));
    await bridge.setLocalStorage('code', code);
    await connect();
  });
  $('demo').addEventListener('click', async () => {
    await bridge.setLocalStorage('code', 'demo');
    await connect();
  });
  bridge.onEvenHubEvent(onEvent);
  ensureKeyFocus();
  showKeyFocus();
  document.getElementById('key-focus')?.addEventListener('click', pressKeyButton);
  window.addEventListener('pageshow', ensureKeyFocus);
  // A focus event alone does not prove that keys arrive (1.0.83 on G2), so it leaves the label as is.
  window.addEventListener('focus', ensureKeyFocus);
  window.addEventListener('blur', () => setKeyState('off'));
  document.addEventListener?.('visibilitychange', () => {
    if (document.visibilityState === 'visible') ensureKeyFocus();
    else setKeyState('off'); // screen off or the Even app in the background: keys stop until a tap
  });
  // Screen off delivers pagehide while this installed page stays alive, the same
  // way Workout Glass's countdown keeps ticking. Clearing the polls here made
  // chats stop until the phone was opened again. A real exit still stops them.
  await connect();
}

main();
