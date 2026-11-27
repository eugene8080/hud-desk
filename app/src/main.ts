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
import { api, currentBase, setApiLang, setConnection, setDemo, type ChatItem, type ChoiceMenu, type MailThread, type Provider, type Thread, type Usage, type Workspace } from './api';
import { parseCode, resolveBase } from './pairing';
import { applyPage, detectLang, getLang, setLang, t as tr } from './i18n';
import { clipBytes, tailBytes, textSections, readerPages, latestResponseStart, choiceNumber, readerContent, glassTextWidth, type ReaderPage } from './text';
import { readerStatus, statusPixels, SPINNER, workingLabels } from './reader-status';
import { statusRight } from './footer-hint';
import { formatReset, RESET_MODES, resetModeLabel, type ResetMode } from './usage-reset';
import { orcaAgents, workspaceSections, toggleWorkspace, workspaceSummary, type PickerRow } from './filters';
import { createPhone, type Connection } from './phone';
import { FINE_FONTS, FINE_TILES, fineLabel, alignMarkdownTables, SCANNER_WIDTH, fineLayout, fineMeasure, fineCells, renderFineScreen, renderFontComparison, renderBackgroundComparison, inkByte, nativeTextColor, parseInk, DEFAULT_TURN_BACKGROUND, TURN_BACKGROUNDS, parseTurnBackground, turnBackgroundLabel, type FineFont, type FineStatus, type TurnBackground } from './fine-text';
import { agentLabel, sessionRow, sessionHeading, moduleHeading, moduleButton, moduleLabel, offeredModules, nextModule, MENU_HEAD, MENU_COUNT, MENU_LEFT, MENU_RIGHT, MENU_CURSOR, MENU_DOTS, sessionAgentLabel, menuNativeText, menuCursorText, nativeRight, glassWidth, compactSessionTitle, type GlassModule, type ModulePosition, type SessionColumns } from './session-list';
import { Mail, mailColumns, MAIL_ACCOUNTS_KEY, MAIL_LABELS_KEY, type ReaderContent, type ReaderSource } from './mail';
import { Chat, ChatReader, chatColumns, CHAT_NETWORKS_KEY, CHAT_TRANSLATE_KEY } from './chat';

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
const USAGE_RESET = { containerID: 3, containerName: 'usage-reset', xPosition: 0, yPosition: 28, width: 576, height: 28 };
const LIST_ITEM_BYTES = 63;
const LIST_MAX = 20;
const TEXT_BYTES = 999;
const POLL_MS = 1000;

type Screen =
  | { kind: 'list'; title: string; items: string[]; module?: GlassModule; workspacePicker?: boolean; mailPicker?: { page: number; search: string }; chatPicker?: { page: number; networks: string[] }; agentPicker?: boolean; textPicker?: boolean; headings?: number[]; menuActions?: { id: number; label: string; run: () => unknown }[]; compat?: boolean; columns?: SessionColumns[]; count?: string; selected?: number; paintedSelection?: number; menuFrame?: number; paintedCursor?: string; cursorWriting?: boolean; paging?: boolean; onPreviousPage?: () => unknown; onNextPage?: () => unknown; onPick: (i: number) => void; onBack?: () => void; onHold?: () => void }
  | { kind: 'text'; title: string; text: string; usageMode?: ResetMode; conversationText?: string; choiceMenu?: ChoiceMenu | null; tail?: boolean; offset?: number; pageText?: string; pages?: ReaderPage[]; pageTarget?: number; pageWriting?: boolean; reading?: boolean; refreshing?: boolean; responsePage?: number; openAtResponse?: boolean; openingOffset?: number; voiceLines?: { id: string; line: number }[]; model?: string; voice?: boolean; voiceHint?: string; voiceTail?: boolean; activityLabel?: string; activityState?: string; reportedSeconds?: number | null; statusFrame?: number; statusStartedAt?: number; savedHistory?: boolean; reader?: ReaderSource & { coding?: Thread }; fine?: FineFont; pagesFine?: FineFont; tiles?: number[][]; fineLabel?: string; fineQueued?: boolean; comparison?: Comparison; menuActions?: { id: number; label: string; run: () => unknown }[]; onClick?: () => void; onBack?: () => void; };

let bridge: EvenAppBridge;
let current: Screen | null = null;
let started = false;
let compactMenuOnly = false;
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
type Comparison = 'fonts' | 'backgrounds';
const DEFAULT_SMALL_FONT: FineFont = 'terminus';
const REMOVED_FONTS = ['fixed9', 'gohu14', 'shinonome'];
let readerText: ReaderText = 'native';
// The small font the menu offers when native text is on (last one used).
let smallFont: FineFont = DEFAULT_SMALL_FONT;
let turnBackground: TurnBackground = DEFAULT_TURN_BACKGROUND;
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

function selectThread(t: Thread | null) {
  if (selectedThread?.handle !== t?.handle) {
    (document.getElementById('reply-text') as HTMLTextAreaElement).value = '';
    document.getElementById('send-reply')!.hidden = true;
    document.getElementById('reply-status')!.textContent = '';
    // The open chat has to survive the phone recreating this page with the screen off.
    void bridge.setLocalStorage('open-thread', t?.handle || '');
  }
  selectedThread = t;
  document.getElementById('composer')!.hidden = !t;
  document.getElementById('reply-target')!.textContent = t ? tr('replyTo', t.title, t.handle.slice(-8)) : '';
}

// Reader body is 560px wide with no padding. 560px rows fit in the simulator; keep
// 8px (under one glyph) in case hardware rendering differs slightly.
const READER_WRAP_WIDTH = 552;
type TextScreen = Extract<Screen, { kind: 'text' }>;
const readerChars = (text: string) => text.replace(/\s/g, '').length; // wrapping only adds/drops spaces
let chatTranslate = false;
let chatTranslateWrites = Promise.resolve();

function readerLayout(s: TextScreen) {
  if (s.pageText === s.text && s.pages && s.pagesFine === s.fine) return s.pages;
  s.pagesFine = s.fine;
  const chatScreen = s.reader instanceof ChatReader;
  const transform = s.fine && !chatScreen ? alignMarkdownTables : (text: string) => text;
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
  return nativeRight(statusRight(seconds, !!s.choiceMenu, page, text => glassWidth(text) <= room), HINT.width);
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
  const fine = s.kind === 'text' && !!s.fine && (!!s.reader || !!s.comparison);
  const uploadText = !fine && (reloadText || (s.kind === 'text' && !!s.reader && s.text.length > 900) || new TextEncoder().encode(content).length > 999);
  const head = new TextContainerProperty({ ...HEAD, ...(s.kind === 'text' && s.usageMode ? { height: 28 } : {}), ...(s.kind === 'text' && s.reader ? { xPosition: 16, yPosition: 2, width: 544, height: 28, zOrderIndex: 1 } : {}), content: clipBytes(screenTitle(s), TEXT_BYTES), isEventCapture: 0 });
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
          containerTotalNum: s.reader ? 7 : s.usageMode ? 3 : 2,
          ...menu,
          textObject: [head, new TextContainerProperty({ ...BODY, ...(s.usageMode ? { yPosition: 64, height: 224 } : {}), ...(s.reader ? { xPosition: 8, yPosition: READER_TOP, width: 560, paddingLength: 0, zOrderIndex: 2, height: READER_HEIGHT, textColor: textBrightness() } : {}), content: uploadText ? '' : content, isEventCapture: 1 }),
            ...(s.usageMode ? [new TextContainerProperty({ ...USAGE_RESET, content: tr('resetLine', resetModeLabel(s.usageMode)), isEventCapture: 0 })] : []),
            ...(s.reader ? [
              new TextContainerProperty({ ...HINT, content: readerHint(s, s.reportedSeconds), textColor: textBrightness(), isEventCapture: 0, paddingLength: 0, zOrderIndex: 6 }),
              new TextContainerProperty({ ...VOICE, content: readerStatusLeft(s), textColor: textBrightness(), isEventCapture: 0, paddingLength: 0, zOrderIndex: 5 }),
              new TextContainerProperty({ ...FRAME, content: ' ', textColor: textBrightness(), borderWidth: 1, borderColor: inkLevel, borderRadius: 0, isEventCapture: 0, zOrderIndex: 0 }),
              new TextContainerProperty({ ...DIVIDER, content: ' ', textColor: textBrightness(), borderWidth: 1, borderColor: inkLevel, isEventCapture: 0, zOrderIndex: 3 }),
            ] : [])],
          ...(s.reader ? { imageObject: [new ImageContainerProperty({ ...STATUS_ICON, xPosition: statusIconX(s.model), zOrderIndex: 4 })] } : {}),
        };
  if (fine) page = { containerTotalNum: 5, ...menu,
    textObject: [new TextContainerProperty({ ...FINE_CAPTURE, content: ' ', isEventCapture: 1, paddingLength: 0, zOrderIndex: 0 })],
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
    let accepted = await bridge.rebuildPageContainer(new RebuildPageContainer(page));
    if (!accepted && s.kind === 'list' && s.module && !s.compat) {
      s.compat = true;
      accepted = await bridge.rebuildPageContainer(new RebuildPageContainer(compatibilityMenu(s, menu)));
      if (accepted) { compactMenuOnly = true; diag(`${sessionHeading()}: aligned layout rejected; compact compatibility menu active.`); }
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
  const tiles = s.comparison === 'fonts' ? renderFontComparison(inkLevel)
    : s.comparison === 'backgrounds' ? renderBackgroundComparison(s.fine!, inkLevel)
    : renderFineScreen(readerLayout(snapshot)[page], s.fine!, fineStatus(snapshot, page), inkLevel, turnBackground);
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
  const right = [minutes, statusRight(null, !!s.choiceMenu, where, text => fineCells([minutes, text].filter(Boolean).join(' ')) <= room)].filter(Boolean).join(' ');
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
    { id: 1101, label: tr('usingFont', name), run: () => showFonts() },
    { id: 1109, label: tr('background', turnBackgroundLabel(turnBackground)), run: () => showBackgrounds(screen) },
    { id: 1107, label: tr('brightness', inkLevel), run: () => showBrightness() },
    ...(screen.reader instanceof ChatReader
      ? [{ id: 1108, label: tr(chatTranslate ? 'chatTranslateEnglish' : 'chatTranslateOff'), run: () => setChatTranslation(!chatTranslate) }]
      : []),
  ];
}

// Ten native rows, no title and no blank row between entries. A swipe past the
// last row opens the next page; a swipe past the first opens the previous one.
// Both lists wrap: past the first row lands on the last, and the reverse.
const TEXT_PICKER_ROWS = 10;
function showTextPicker(reader: TextScreen, labels: string[], selected: number, onPick: (i: number) => unknown, wrap = false) {
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
      onBack: () => show(reader),
    });
  };
  const at = Math.max(0, Math.min(selected, labels.length - 1));
  return open(Math.floor(at / TEXT_PICKER_ROWS), at % TEXT_PICKER_ROWS);
}

// Native, every small font largest first, then the font comparison.
function showFonts() {
  const reader = current;
  if (reader?.kind !== 'text' || !reader.reader) return;
  const fonts = [...FINE_FONTS].reverse();
  const rows = [
    { label: tr('nativeText'), run: () => setReaderText('native', reader) },
    ...fonts.map(font => ({ label: fineLabel(font), run: () => setReaderText(font, reader) })),
    { label: tr('compareFonts'), run: () => openComparison(reader, 'fonts') },
  ];
  const currentIndex = readerText === 'native' ? 0 : fonts.indexOf(readerText) + 1;
  return showTextPicker(reader, rows.map((row, i) => i === currentIndex ? `${row.label} ✓` : row.label), currentIndex, i => {
    void rows[i]?.run().catch(e => diag((e as Error).message));
  }, true);
}

// Backgrounds menu (Eugene, 2026-11-27): its own row in the reader's long-press menu. Compare
// backgrounds first, then every option.
function showBackgrounds(reader: TextScreen) {
  const selected = TURN_BACKGROUNDS.indexOf(turnBackground);
  const labels = [tr('compareBackgrounds'), ...TURN_BACKGROUNDS.map((option, i) => turnBackgroundLabel(option) + (i === selected ? ' ✓' : ''))];
  let saving = false;
  return showTextPicker(reader, labels, selected + 1, async i => {
    if (i === 0) { await openComparison(reader, 'backgrounds').catch(e => diag((e as Error).message)); return; }
    const option = TURN_BACKGROUNDS[i - 1];
    if (saving || !option) return;
    const picker = current;
    saving = true;
    try {
      if (!await bridge.setLocalStorage('reader-turn-bg', option)) throw new Error(tr('backgroundSaveFailed'));
      turnBackground = option;
      if (current === picker) await show(reader);
    } catch (e) { diag((e as Error).message); }
    finally { saving = false; }
  }, true);
}

// Steps 15 down to 1, ten per page. A swipe past either end wraps to the other.
// Click one and the reader comes back at that ink.
function showBrightness() {
  const reader = current;
  if (reader?.kind !== 'text' || !reader.reader) return;
  const levels = Array.from({ length: 15 }, (_, i) => 15 - i);
  const at = Math.max(0, levels.indexOf(inkLevel));
  return showTextPicker(reader, levels.map(n => n === inkLevel ? `${n} ✓` : String(n)), at, async i => {
    inkLevel = levels[i];
    await bridge.setLocalStorage('reader-ink', String(inkLevel));
    await show(reader);
  }, true);
}

// Both comparisons use the reader's tiles and return to the same page on a swipe.
function openComparison(reader: TextScreen, comparison: Comparison) {
  const back = () => { void show(reader).catch(e => diag((e as Error).message)); };
  return show({ kind: 'text', title: ' ', text: '', fine: reader.fine ?? smallFont, comparison, onBack: back });
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
    // Hermes Agent lists only Hermes sessions; All Orca sessions and each Orca agent
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
      { label: `* ${tr('filterAgent')} [${providerFilterLabel()}]`, run: () => viewOptions() },
      { label: `* ${tr('filterWorkspace')} [${workspaceFilter}]`, run: () => workspaceOptions() },
      ...visible.map(t => ({ label: sessionRow(t.title, t.handle, t.agent, t.state, t.workspaceName), run: () => thread(t) })),
    ];
    const columns = actions.map((a, i): SessionColumns => {
      const t = i >= 2 ? visible[i - 2] : undefined;
      if (t) return { marker: t.state === 'idle' ? '/' : t.state === 'busy' ? '' : '?', title: compactSessionTitle(t.title, t.handle), right: sessionAgentLabel(t.workspaceName || '', t.agent), busy: t.state === 'busy', handle: t.handle };
      return i === 0 ? { marker: '*', title: tr('filterAgent'), right: `[${providerFilterLabel()}]` }
        : i === 1 ? { marker: '*', title: tr('filterWorkspace'), right: `[${workspaceFilter}]` } : { marker: '', title: a.label, right: '' };
    });
    await showModuleList('coding', page, selected, { columns, count: tr('sessionCount', allThreads.length),
      onPreviousPage: page > 0 ? () => home(page - 1, -1) : undefined,
      onNextPage: page + 1 < pageCount ? () => home(page + 1, 1) : undefined,
      menuActions: [
        { id: 1001, label: tr('refreshSessions'), run: () => home(page, 1) },
        { id: 1002, label: tr('menuNewSession'), run: newSession },
        { id: 1003, label: tr('menuUsage'), run: usage },
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
  if (i === (mailbox ? 1 : 0)) { void mailLabels(0, 0, true); return true; }
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
    const lead = mailLeadRows(result.mailbox, result.filterColumn);
    const columns = [...lead, ...result.items.map(item => mailColumns(item))];
    // An incomplete page keeps a moving-dot row below its threads while it fills in.
    if (loading() && retry < MAIL_RETRIES && result.items.length < result.size) columns.push({ marker: '', title: tr('mailLoadingMore'), right: '', busy: true });
    const shown = await showModuleList('email', page, selected, { columns, count: tr('mailUnread', result.unread),
      items: columns.map(row => `${row.marker || ' '} ${row.title} ${row.right}`),
      onPreviousPage: page > 0 ? () => mailHome(page - 1, -1) : undefined,
      onNextPage: result.hasMore ? () => mailHome(page + 1, 1) : undefined,
      menuActions: [{ id: 1001, label: tr('refresh'), run: () => mailHome() }],
      onPick: i => { if (!pickMailLead(i, result.mailbox) && result.items[i - lead.length]) void openMail(result.items[i - lead.length]); },
    }, mounted);
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
  const pickFilter = () => { void chatNetworks(); };
  const menuActions = [{ id: 1001, label: tr('refresh'), run: () => chatHome() }];
  try {
    let result = await chat.list(page);
    while (page > 0 && !result.items.length && !result.hasMore && active()) result = await chat.list(--page);
    if (!active()) return;
    const columns = [{ ...filter, right: result.filterColumn }, ...result.items.map(chatColumns)];
    await showModuleList('chat', page, selected, { columns, count: tr('chatUnread', result.unread),
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
  const back = () => chatHome(positions.chat.page, 1);
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
        if (i === 0) { await back(); return; }
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

async function mailLabels(page: number, selected: number, refresh = false, search = '') {
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
    const done = () => mailHome(positions.email.page, 1);
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
      }, onBack: search ? () => mailLabels(0, 0) : done,
      onHold: voiceAvailable ? () => { void record({ search: text => mailLabels(0, 0, false, text) }, true); } : undefined,
    });
  } catch {
    if (current === owner && revision === moduleRevision) await show({ kind: 'text', title: moduleLabel('email'), text: tr('mailUnavailable'), onBack: mailHome, onClick: mailHome });
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
      onPick: i => { if (!headings.includes(i)) void rows[i]?.run(); }, onBack: home });
  }, home);
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
      { label: tr('done'), run: () => home() },
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
      onPick: i => { if (!headings.includes(i)) void actions[i]?.run(); }, onBack: () => home() });
  }, home);
}

function thread(t: Thread, note = '') {
  selectThread(t);
  const load = async () => {
    const snapshot = await api.thread(t.handle);
    const saved = await api.history(t.handle).catch(() => null);
    const useSaved = ['codex-transcript', 'claude-transcript', 'cursor-transcript', 'opencode-transcript', 'pi-transcript', 'hermes-transcript'].includes(saved?.source || '');
    const conversationText = useSaved ? saved!.text : snapshot.text;
    const state = await api.activity(t.handle).catch(e => {
      diag(`Activity request failed: ${(e as Error).message}`);
      return { state: 'unknown', elapsedSeconds: null };
    });
    const text = readerContent(conversationText, snapshot.menu, snapshot.progress, t.agent === 'claude' && state.state === 'working');
    return { text, conversationText, choiceMenu: snapshot.menu, model: (useSaved ? saved!.model : undefined) || snapshot.model, activityState: state.state, reportedSeconds: state.state === 'working' ? state.elapsedSeconds ?? null : null, activityLabel: activityLabel(state.state), savedHistory: useSaved };
  };
  const source = { title: `${t.title}${note ? `  ${note}` : ''}`, load, coding: t, hold: () => { void record({ thread: t }, true); } };
  return guard(t.title, async () => {
    await openReader(source, home, () => { if (current?.kind === 'text' && current.choiceMenu) void replies(t); });
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
  const owner = current;
  const revision = moduleRevision;
  const back = () => mailHome();
  const unread = thread.unread;
  try {
    await openReader(mail.reader(thread), back);
    if (unread && !thread.unread) void phone?.refreshLabels();
  }
  catch {
    if (current === owner && revision === moduleRevision) await show({ kind: 'text', title: moduleLabel('email'), text: tr('mailUnavailable'), onBack: back, onClick: back });
  }
}

async function openChat(item: ChatItem) {
  const owner = current;
  const revision = moduleRevision;
  const back = () => chatHome();
  let outcome: 'chatSent' | 'chatNotSent' | undefined;
  const hold = voiceAvailable && !item.readOnly ? () => {
    void record({ reply: async text => (await api.chat.send(item.id, text)).ok,
      onResult: sent => { outcome = sent ? 'chatSent' : 'chatNotSent'; } }, true);
  } : undefined;
  let readFailed = false;
  const source = new ChatReader(item, () => chatTranslate, () => outcome ? tr(outcome) : readFailed ? tr('chatNotMarkedRead') : ' ', hold);
  try {
    const screen = await openReader(source, back, () => {
      if (current?.kind !== 'text' || current.reader !== source || current.pageWriting) return;
      const screen = current;
      const page = readerLayout(screen)[screen.offset ?? 0];
      const ids = (screen.voiceLines ?? []).filter(({ line }) => line >= page.firstLine && line <= page.lastLine).map(({ id }) => id);
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
    if (screen.reportedSeconds !== seconds) {
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
    await show({ kind: 'text', title, text, tail: true, reader: { title, load: async () => ({ text }), coding: t, hold: () => { void record({ thread: t }, true); } },
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

function usageText(u: Usage, mode: ResetMode) {
  const all = Object.entries(u).filter(([, v]) => v && typeof v === 'object' && 'provider' in v);
  const ok = all.filter(([, v]) => v.status === 'ok');
  const ng = all.filter(([, v]) => v.status !== 'ok').map(([name]) => name);
  const lines = ok.map(([name, v]) => {
    const percent = (value: number) => Math.round(value * 10) / 10;
    const s = v.session ? `5h ${percent(v.session.usedPercent)}% (${formatReset(v.session, mode)})` : '';
    const w = v.weekly ? `${tr('weekly')} ${percent(v.weekly.usedPercent)}% (${formatReset(v.weekly, mode)})` : '';
    const m = v.monthly ? `${tr('monthly')} ${percent(v.monthly.usedPercent)}% (${formatReset(v.monthly, mode)})` : '';
    return `${providerName(v.provider || name)}\n  ${[s, w, m].filter(Boolean).join(' / ') || tr('noInfo')}`;
  });
  if (ng.length) lines.push(tr('unavailable', ng.join(', ')));
  return lines.join('\n');
}

function usage() {
  return guard(tr('usageTitle'), async () => {
    const u = await api.usage();
    let writing = false;
    const screen: Extract<Screen, { kind: 'text' }> = { kind: 'text', title: tr('usageTitle'),
      usageMode: usageResetMode, text: usageText(u, usageResetMode), onBack: home,
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
          screen.usageMode = next;
          if (current !== screen) return;
          await bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: USAGE_RESET.containerID, containerName: USAGE_RESET.containerName,
            content: tr('resetLine', resetModeLabel(next)) }));
        }
        if (current !== screen) return;
        const text = usageText(u, usageResetMode);
        if (text !== screen.text) {
          screen.offset = undefined;
          await updateText(screen.title, text);
        }
      } catch (e) { diag((e as Error).message); }
      finally { writing = false; }
    };
    await show(screen);
    if (current === screen) poll = setInterval(() => {
      if (usageResetMode === 'absolute') void update();
    }, 60000);
  }, home);
}

// 新規セッション: 作業場所 → エージェント → モデル → 最初の指示 → 確認
function newSession() {
  return guard(tr('newTitle'), async () => {
    const ws = await api.workspaces();
    await show({
      kind: 'list',
      title: tr('step1'),
      items: ws.map((w) => w.name),
      onPick: (i) => ws[i] && pickAgent(ws[i]),
      onBack: home,
    });
  }, home);
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

function onEvent(e: EvenHubEvent) {
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
    if (s.comparison) s.onBack?.();
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
  if (code === 'demo') {
    diag(tr('diagOk', 0, tr('viaDemo'), '-', 3));
    return openSavedOrHome({ state: 'demo' });
  }
  if (!pairing) {
    diag(tr('notPairedDiag'));
    phone?.connection({ state: 'unpaired' });
    return show({ kind: 'text', title: 'Orca Glass', text: tr('notPaired') });
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
  const stored = await bridge.getLocalStorage('module') as GlassModule;
  activeModule = modules.includes(stored) ? stored : 'coding';
  mail = new Mail(await bridge.getLocalStorage(MAIL_LABELS_KEY), await bridge.getLocalStorage(MAIL_ACCOUNTS_KEY), saveMailPref);
  chat = new Chat(await bridge.getLocalStorage(CHAT_NETWORKS_KEY));
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
  if (s.kind === 'text' && s.usageMode) { void usage(); return; }
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
      if (current?.kind === 'text' && current.usageMode) void usage();
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
  let reviewed: { handle: string; text: string } | null = null;
  draft.addEventListener('input', () => { reviewed = null; send.hidden = true; });
  document.getElementById('reply-form')!.addEventListener('submit', ev => {
    ev.preventDefault();
    if (!selectedThread || sending || !draft.value.trim()) return;
    reviewed = { handle: selectedThread.handle, text: draft.value.trim() };
    status.textContent = tr('readyToSend', selectedThread.title, reviewed.text);
    send.hidden = false;
  });
  send.addEventListener('click', async () => {
    if (sending || !reviewed || reviewed.handle !== selectedThread?.handle || reviewed.text !== draft.value.trim()) return;
    const message = reviewed;
    reviewed = null;
    sending = true;
    send.hidden = true;
    status.textContent = tr('sending');
    try {
      await api.say(message.handle, message.text);
      if (selectedThread?.handle === message.handle) {
        draft.value = '';
        status.textContent = tr('sentDone');
      }
    } catch (e) {
      if (selectedThread?.handle === message.handle) status.textContent = (e as Error).message;
    } finally { sending = false; }
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
  // Screen off delivers pagehide while this installed page stays alive, the same
  // way Workout Glass's countdown keeps ticking. Clearing the polls here made
  // chats stop until the phone was opened again. A real exit still stops them.
  await connect();
}

main();
