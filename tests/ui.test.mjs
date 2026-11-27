import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import ts from '../app/node_modules/typescript/lib/typescript.js';

// The real dictionary, shared by every module below (one language state).
const i18nExports = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../app/src/i18n.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: i18nExports });
const textExports = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../app/src/text.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: textExports, TextEncoder });
const readerPageText = (...args) => textExports.readerPages(...args).map(page => page.text);

test('the user-turn highlight covers wrapped and inner blank rows but not the gap before the reply', () => {
  const [page] = textExports.readerPages('/ first line\n\n  more from the user\n\n\n> the reply', text => text.length, 200, 10, Infinity);
  assert.deepEqual([...page.userTurns], [1, 1, 1, 0, 0, 0]);
});
const statusExports = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../app/src/reader-status.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: statusExports, require: () => i18nExports });
const hintExports = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../app/src/footer-hint.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: hintExports, require: () => i18nExports, document: { createElement: () => ({ getContext: () => ({ fillRect() {}, fillText() {}, getImageData: () => ({ data: new Uint8ClampedArray(280 * 28 * 4) }) }) }) } });
const usageResetExports = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../app/src/usage-reset.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: usageResetExports, require: () => i18nExports });

const glyphExports = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../app/src/fonts/glyphs.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: glyphExports });
const fineExports = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../app/src/fine-text.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: fineExports, require: name => ({ './i18n': i18nExports, './text': textExports, './fonts/glyphs': glyphExports })[name], Uint8ClampedArray });
const renderFineText = (text, ...args) => fineExports.renderFineScreen({ text, userTurns: [] }, ...args);
const filterExports = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../app/src/filters.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: filterExports, require: () => i18nExports });

const listExports = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../app/src/session-list.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: listExports, __APP_VERSION__: '1.0.12', require: name => name === './i18n' ? i18nExports : textExports, TextEncoder, document: { createElement: () => ({ getContext: () => ({ font: '', measureText: t => ({ width: t.length * 10 }) }) }) } });
const mailSource = ts.transpileModule(readFileSync(new URL('../app/src/mail.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function mailModule(api) {
  const exports = {};
  vm.runInNewContext(mailSource, { exports, require: name => ({ './i18n': i18nExports, './session-list': listExports, './api': { api } })[name] });
  return exports;
}

const chatSource = ts.transpileModule(readFileSync(new URL('../app/src/chat.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function chatModule(api) {
  const exports = {};
  vm.runInNewContext(chatSource, { exports, require: name => ({ './i18n': i18nExports, './mail': mailModule(api), './api': { api } })[name] });
  return exports;
}

// Exercise the real controller with a simulated Even bridge: no agent input,
// microphone access, network, or hardware claims.
async function harness(count = 2, voice = false, mode = 'tap', savedView = '', startupResult = 0, rejectAlignedMenu = false, savedWorkspaces = '', savedUsage = '', savedOpen = '', options = {}) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: '', hidden: false, textContent: '', listeners: {}, addEventListener(name, fn) { this.listeners[name] = fn; } });
    return elements.get(id);
  };
  const threads = Array.from({ length: count }, (_, i) => ({ handle: `terminal-${i}`, title: `Session ${i}`, agent: 'codex', state: 'unknown' }));
  const pages = [], sends = [], choices = [], timers = new Map(), mic = [], upgrades = [], transcriptions = [], images = [];
  const animations = new Map();
  const timeouts = new Map();
  const storage = new Map(Object.entries(options.storage ?? {}));
  let exited = 0;
  let timerId = 0, event, phoneDeps;
  const windowListeners = new Map();
  const phoneCalls = [];
  const api = {
    activity: async () => ({ state: 'unknown' }),
    threads: async () => threads,
    workspaces: async () => [],
    thread: async h => ({ text: `Content ${h}` }),
    history: async () => ({ text: 'Older terminal output' }),
    capabilities: async () => ({ voice, ...(options.capabilities ?? {}) }),
    mail: options.mail,
    chat: options.chat,
    transcribe: async pcm => { transcriptions.push(pcm); return { text: 'A voice test.' }; },
    say: async (handle, text) => { sends.push({ handle, text }); return { sent: text }; },
    choice: async (handle, menuId, value) => { choices.push({ handle, menuId, value }); return { sent: value }; },
  };
  const bridge = {
    updateImageRawData: async value => { images.push(value); return 'success'; },
    getLocalStorage: async key => storage.get(key) ?? (key === 'code' ? 'demo' : key === 'recording-mode' ? mode : key === 'lang' ? 'en' : key === 'view-provider' ? savedView : key === 'view-workspaces' ? savedWorkspaces : key === 'usage-reset-mode' ? savedUsage : key === 'open-thread' ? savedOpen : ''),
    setLocalStorage: async (key, value) => { storage.set(key, value); return true; },
    shutDownPageContainer: async () => { exited++; },
    createStartUpPageContainer: async p => { pages.push(p); pageMarks.set(p, upgrades.length); return startupResult; },
    rebuildPageContainer: async p => { pages.push(p); pageMarks.set(p, upgrades.length); return !(rejectAlignedMenu && p.textObject.some(c => c.containerName === 'menu-right') && (rejectAlignedMenu !== 'images' || !!p.imageObject)); },
    textContainerUpgrade: async value => { upgrades.push(value); return true; },
    onEvenHubEvent: fn => { event = fn; },
    audioControl: async on => { mic.push(on); return true; },
  };
  class Property { constructor(value) { Object.assign(this, value); } }
  const sdk = new Proxy({ ImageRawDataUpdateResult: { success: 'success' }, waitForEvenAppBridge: async () => bridge, AudioInputSource: { Glasses: 0 }, OsEventTypeList: { CLICK_EVENT: 0, SCROLL_TOP_EVENT: 1, SCROLL_BOTTOM_EVENT: 2, DOUBLE_CLICK_EVENT: 3, SYSTEM_EXIT_EVENT: 7, ABNORMAL_EXIT_EVENT: 6, LONG_PRESS_EVENT: 9, LONG_PRESS_RELEASE_EVENT: 10 } }, { get: (target, key) => target[key] ?? Property });
  const imports = {
    '@evenrealities/even_hub_sdk': sdk,
    './api': { api, setDemo() {}, setApiLang() {}, currentBase: () => '' },
    './pairing': { parseCode: () => null },
    // Real dictionary; the page-filling DOM step is a no-op without a document.
    './i18n': { ...i18nExports, applyPage() {} },
    './text': textExports,
    './reader-status': statusExports,
    './footer-hint': hintExports,
    './usage-reset': usageResetExports,
    './session-list': listExports,
    './mail': mailModule(api),
    './chat': chatModule(api),
    './filters': filterExports,
    './fine-text': fineExports,
    // The phone page is DOM-only and checked in a browser preview; the glasses tests see a no-op.
    './phone': { createPhone: deps => { phoneDeps = deps; return { connection: c => phoneCalls.push(['connection', c.state]), load() {}, render: () => phoneCalls.push(['render']), retranslate: () => phoneCalls.push(['retranslate']), refreshLabels() {} }; } },
  };
  const source = ts.transpileModule(readFileSync(new URL('../app/src/main.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, {
    exports: {}, require: name => imports[name], document: { getElementById: element },
    location: { search: '' }, window: { addEventListener(name, fn) { windowListeners.set(name, fn); } }, URLSearchParams, Uint8Array, TextEncoder,
    setInterval: (fn, delay) => { (delay === 200 ? animations : timers).set(++timerId, fn); return timerId; },
    clearInterval: id => { timers.delete(id); animations.delete(id); },
    setTimeout: (fn, delay) => { timeouts.set(++timerId, { fn, delay }); return timerId; },
    clearTimeout: id => timeouts.delete(id),
  });
  const flush = () => new Promise(resolve => setImmediate(resolve));
  await flush();
  const pickRow = async i => { event({ listEvent: { currentSelectItemIndex: i, eventType: 0 } }); await flush(); };
  return { api, bridge, elements, pages, sends, choices, threads, timers, animations, mic, upgrades, images, transcriptions, flush, phone: () => phoneDeps, phoneCalls, storage, timeouts, exited: () => exited, pickRow,
    debounce: async () => { for (const [id, { fn }] of timeouts) { timeouts.delete(id); fn(); } await flush(); },
    menu: async id => { event({ menuItemClickEvent: { itemID: id } }); await flush(); },
    system: async type => { event({ sysEvent: { eventType: type } }); await flush(); },
    press: () => { event({ sysEvent: { eventType: 9 } }); },
    release: () => { event({ sysEvent: { eventType: 10 } }); },
    audio: () => { event({ audioEvent: { audioPcm: new Uint8Array(32000) } }); },
    // Existing Coding checks index the body rows. Selector tests use the physical row.
    pick: i => pickRow(i + (pages.at(-1).menuObject?.menuItems?.some(item => item.itemID === 1001) ? 1 : 0)),
    tap: async () => { event({ textEvent: { eventType: 0 } }); await flush(); },
    back: async () => { event({ textEvent: { eventType: 3 } }); await flush(); },
    scroll: async direction => { event({ textEvent: { eventType: direction === 'up' ? 1 : 2 } }); await flush(); },
    pagehide: () => { windowListeners.get('pagehide')?.(); },
  };
}

const voiceBody = h => h.upgrades.findLast(u => u.containerName === 'voice-body')?.content;

const moduleHarness = options => harness(15, false, 'tap', '', 0, false, '', '', '', options);
// What the glasses show in a container: the latest page's text, or a newer in-place update of it
// (Email fills its rows in place after the loading screen).
const pageMarks = new WeakMap();
const container = (h, name) => {
  const page = h.pages.at(-1);
  const base = page.textObject.find(c => c.containerName === name);
  const update = h.upgrades.slice(pageMarks.get(page) ?? 0).findLast(u => u.containerName === name);
  return base && update && update.content !== undefined ? { ...base, content: update.content } : base;
};
const mailFixture = () => {
  const date = new Date(2026, 10, 25, 14, 5).getTime();
  const item = { account: 'work', id: 'news-1', from: 'Test Desk', subject: 'Field survey', date, unread: true, count: 2 };
  const messages = [
    { id: 'old', from: 'First Desk', date: date - 60_000, text: 'Earlier notes.' },
    { id: 'new', from: 'Second Desk', date, text: Array.from({ length: 15 }, (_, i) => `Survey line ${i + 1}.`).join('\n') },
  ];
  const requests = [];
  const fixture = {
    accounts: async () => [{ id: 'work', short: 'W', ok: true }],
    labels: async () => [{ id: 'INBOX', name: 'Inbox', unread: Number(item.unread) }, { id: 'Label_1', name: 'Bulletins', unread: Number(item.unread) }],
    threads: async (filter, page, size = 8) => {
      requests.push({ filter: [...filter], page, size });
      return { items: Array.from({ length: size }, (_, i) => ({ ...item, id: `page${page}-${i}`, subject: page ? `Page ${page} survey` : item.subject })), hasMore: page === 0, unread: Number(item.unread) };
    },
    thread: async () => ({ subject: item.subject, messages }),
    read: async () => { item.unread = false; return { ok: true }; },
  };
  return { fixture, messages, requests };
};

function chatFixture() {
  const date = new Date(2026, 10, 25, 14, 5).getTime();
  const networks = ['Signal', 'Telegram', 'WhatsApp'];
  const rows = Array.from({ length: 10 }, (_, i) => ({
    id: `fixture-${i}`, title: `Sample group ${i + 1}`, date: date - i * 60_000, unread: i % 2 === 0,
    network: networks[i % networks.length], readOnly: i === 9,
  }));
  const messages = [
    { own: false, from: 'Fixture sender', date, text: 'Synthetic latest message.\n' + Array.from({ length: 12 }, (_, i) => `Sample line ${i + 1}.`).join('\n') },
    { own: true, from: '', date: date - 60_000, text: 'Synthetic earlier message.' },
  ];
  const sends = [], lists = [], reads = [];
  const chat = {
    networks: async () => networks,
    list: async (picks, page) => {
      lists.push({ picks: [...picks], page });
      const matches = rows.filter(row => !picks.length || picks.includes(row.network));
      return { items: matches.slice(page * 8, page * 8 + 8), hasMore: matches.length > (page + 1) * 8,
        unread: matches.filter(row => row.unread).length };
    },
    messages: async id => { reads.push(id); return { messages: [...messages] }; },
    send: async (id, text) => { sends.push({ id, text }); return { ok: true }; },
  };
  return { chat, sends, lists, reads, messages, networks, rows };
}

test('Row zero cycles Coding, Email, Chat, then Coding in bridge capability order', async () => {
  const { chat } = chatFixture();
  const h = await moduleHarness({ capabilities: { modules: ['chat', 'email', 'coding'] }, mail: mailFixture().fixture, chat });
  assert.deepEqual([...h.phone().modules().offered], ['coding', 'email', 'chat']);
  for (const name of ['Email', 'Chat', 'Coding']) {
    await h.tap(); await h.debounce();
    assert.ok(container(h, 'head').content.startsWith(`[${name}]`));
    assert.equal(h.storage.get('module'), name.toLowerCase());
  }
});

test('Chat list uses eight rows, unread markers and a saved filter shared with the phone', async () => {
  const { chat, lists, networks } = chatFixture();
  const h = await moduleHarness({ capabilities: { modules: ['coding', 'chat'] }, storage: { module: 'chat' }, chat });
  assert.match(container(h, 'menu-count').content, /5 unread chats/);
  assert.match(container(h, 'body').content, /Sample group 8/);
  assert.doesNotMatch(container(h, 'body').content, /Sample group 9/);
  assert.match(container(h, 'menu-cursor').content.split('\n')[2], /\//);
  assert.match(container(h, 'menu-cursor').content.split('\n')[3], /^.-$/);
  for (let i = 0; i < 10; i++) await h.scroll('down');
  assert.match(container(h, 'body').content, /Sample group 9/);
  assert.equal(lists.at(-1).page, 1);
  await h.pickRow(1);
  assert.match(container(h, 'body').content, /\[x\] Signal/);
  await h.pickRow(2);
  assert.equal(h.phone().chatNetworkSelected('Signal'), false);
  assert.equal(h.storage.get('chat-networks'), '["Telegram","WhatsApp"]');
  await h.phone().toggleChatNetwork('Telegram', networks);
  assert.match(container(h, 'body').content, /\[ \] Telegram/);
  await h.pickRow(0);
  assert.match(container(h, 'menu-right').content, /\[WhatsApp\]/);
  assert.deepEqual(lists.at(-1), { page: 0, picks: ['WhatsApp'] });
  const restored = await moduleHarness({ capabilities: { modules: ['coding', 'chat'] },
    storage: Object.fromEntries(h.storage), chat });
  assert.equal(restored.phone().chatNetworkSelected('Signal'), false);
  assert.match(container(restored, 'menu-right').content, /\[WhatsApp\]/);
});

test('Chat reader opens at the newest message start and refreshes past the last page without a write', async () => {
  const { chat, messages, reads, sends } = chatFixture();
  const h = await moduleHarness({ capabilities: { modules: ['coding', 'chat'] }, storage: { module: 'chat' }, chat });
  await h.pickRow(2);
  assert.match(container(h, 'body').content, /^> Fixture sender: Synthetic latest message/);
  await h.scroll('up');
  assert.match(h.upgrades.findLast(item => item.containerName === 'body').content, /^\/ Synthetic earlier message/);
  assert.equal(reads.length, 1);
  messages.push({ text: 'Synthetic refresh result.', date: messages[0].date + 1000, own: true, from: '' });
  for (let i = 0; i < 3; i++) await h.scroll('down');
  assert.equal(reads.length, 2);
  assert.match(h.upgrades.findLast(item => item.containerName === 'body').content, /^\/ Synthetic refresh result/);
  assert.equal(sends.length, 0);
  await h.back();
  assert.match(container(h, 'menu-count').content, /5 unread chats/);
});

test('Shared reader page metadata carries Chat user turns across message continuations', () => {
  const { chatReaderText } = chatModule({});
  const { text } = chatReaderText({ messages: [
    { own: true, from: '', date: 1, text: 'Synthetic first line.\nSecond line.' },
    { own: false, from: 'Fixture sender', date: 2, text: 'Synthetic reply.\n/ Message text.' },
  ] });
  // No blank row between messages (2026-11-27).
  assert.equal(text, '/ Synthetic first line.\n  Second line.\n> Fixture sender: Synthetic reply.\n  / Message text.');
  const [page] = textExports.readerPages(text, str => str.length, 60);
  assert.deepEqual([...page.userTurns], [1, 1, 0, 0]);
});

test('Chat shares Coding voice review, sends once per click, and cancels with no POST', async () => {
  const { chat, sends } = chatFixture();
  const h = await harness(2, true, 'hold', '', 0, false, '', '', '',
    { capabilities: { modules: ['coding', 'chat'] }, storage: { module: 'chat' }, chat });
  await h.pickRow(2);
  const review = async () => { h.press(); await h.flush(); h.audio(); h.release(); await h.flush(); };
  await review();
  assert.equal(voiceBody(h), 'A voice test.');
  assert.match(h.upgrades.findLast(item => item.containerName === 'voice-hint').content, /Tap to send \/ Double tap to cancel/);
  assert.equal(sends.length, 0);
  await h.back();
  assert.equal(sends.length, 0);
  await review();
  let complete;
  chat.send = (id, text) => { sends.push({ id, text }); return new Promise(resolve => { complete = resolve; }); };
  await h.tap(); await h.tap();
  assert.deepEqual(sends, [{ id: 'fixture-0', text: 'A voice test.' }]);
  complete({ ok: true }); await h.flush();
  assert.equal(container(h, 'voice').content, 'sent');
  await review();
  chat.send = async () => { throw new Error('Synthetic failure'); };
  await h.tap();
  assert.equal(container(h, 'voice').content, 'not sent');
  assert.equal(h.sends.length, 0);
});

test('row zero fits the centered longest release title, module labels and counts', () => {
  const { glassWidth, moduleHeading, nativeRight, MENU_HEAD, MENU_COUNT } = listExports;
  const heading = 'Orca-glass 1.0.59';
  for (const [label, count] of [['Coding', '9999 sessions'], ['Email', '99999 unread'], ['コーディング', 'セッション9999件'], ['メール', '未読99999件']]) {
    const row = moduleHeading(label, heading);
    const centre = MENU_HEAD.xPosition + glassWidth(row.slice(0, -heading.length));
    const headEnd = centre + glassWidth(heading);
    const countRow = nativeRight(count, MENU_COUNT.width);
    const countStart = MENU_COUNT.xPosition + glassWidth(countRow.slice(0, -count.length));
    assert.ok(Math.abs(centre + glassWidth(heading) / 2 - 288) <= glassWidth(' ') / 2);
    assert.ok(MENU_HEAD.xPosition + glassWidth(label) < centre);
    assert.ok(headEnd + 6 <= countStart, `${row} / ${countRow}`);
    assert.ok(MENU_COUNT.xPosition + glassWidth(countRow) <= 576);
  }
});

test('row zero debounces module loads, wraps over offered modules, and restores each position', async () => {
  const { fixture, requests } = mailFixture();
  const h = await moduleHarness({ capabilities: { modules: ['coding', 'future', 'email', 'email'] }, mail: fixture });
  assert.match(container(h, 'head').content, /^\[Coding\]\s+Orca-glass/);
  for (let i = 0; i < 10; i++) await h.scroll('down');
  const codingPage = container(h, 'body').content;
  assert.match(codingPage, /Session 7/);
  assert.match(container(h, 'menu-cursor').content.split('\n')[1], /^>/);
  await h.scroll('up');
  assert.match(h.upgrades.at(-1).content.split('\n')[0], /^>/);
  await h.tap();
  assert.match(h.upgrades.at(-1).content, /^\[Email\]\s+Orca-glass/);
  assert.equal([...h.timeouts.values()][0].delay, 400);
  assert.equal(requests.length, 0);
  await h.tap(); await h.debounce();
  assert.equal(requests.length, 0);
  assert.equal(h.storage.get('module'), 'coding');
  await h.tap(); await h.debounce();
  assert.equal(h.storage.get('module'), 'email');
  assert.equal(requests[0].page, 0);
  for (let i = 0; i < 10; i++) await h.scroll('down');
  assert.match(container(h, 'body').content, /Page 1 survey/);
  await h.scroll('up'); await h.tap(); await h.debounce();
  assert.equal(container(h, 'body').content, codingPage);
  assert.match(container(h, 'menu-cursor').content.split('\n')[0], /^>/);
  await h.tap(); await h.debounce();
  assert.match(container(h, 'body').content, /Page 1 survey/);
  assert.match(container(h, 'menu-cursor').content.split('\n')[0], /^>/);
  await h.back();
  assert.equal(h.exited(), 1);
});

test('missing capability modules fall back to Coding even with Email saved', async () => {
  const h = await moduleHarness({ storage: { module: 'email' } });
  assert.match(container(h, 'head').content, /^\[Coding\]/);
  const page = h.pages.at(-1);
  await h.tap(); await h.debounce();
  assert.equal(h.pages.at(-1), page);
  assert.equal(h.timeouts.size, 0);
});

test('phone and glasses use the same module and label selection in both directions', async () => {
  const { fixture, requests } = mailFixture();
  const h = await moduleHarness({ capabilities: { modules: ['coding', 'email'] }, mail: fixture });
  const phone = h.phone();
  assert.deepEqual([...phone.modules().offered], ['coding', 'email']);
  await phone.setModule('email'); await h.flush();
  assert.equal(h.timeouts.size, 0);
  assert.match(container(h, 'head').content, /^\[Email\]/);
  assert.equal(h.storage.get('module'), 'email');
  assert.equal(phone.selectedMailLabels().has('work:INBOX'), true);
  await phone.toggleMailLabel('work:Label_1');
  assert.match(container(h, 'menu-right').content, /Inbox \+1/);
  assert.deepEqual(requests.at(-1).filter, ['work:INBOX', 'work:Label_1']);
  await h.pickRow(1);
  assert.match(container(h, 'body').content, /\[x\] Bulletins/);
  await phone.toggleMailLabel('work:INBOX');
  assert.match(container(h, 'body').content, /\[ \] Inbox/);
  await h.pickRow(2);
  assert.equal(phone.selectedMailLabels().has('work:INBOX'), true);
  assert.equal(h.storage.get('mail-labels'), '["work:Label_1","work:INBOX"]');
  await h.back(); await h.scroll('up'); await h.tap();
  assert.equal(phone.modules().selected, 'coding');
  await h.debounce();
  assert.match(container(h, 'head').content, /^\[Coding\]/);
  assert.equal(h.storage.get('module'), 'coding');
});

test('a cached module paints before its delayed refresh and applies new rows without moving the cursor', async () => {
  const { fixture } = mailFixture();
  const h = await moduleHarness({ capabilities: { modules: ['coding', 'email'] }, mail: fixture });
  await h.tap(); await h.debounce();
  let complete;
  h.api.threads = () => new Promise(resolve => { complete = resolve; });
  await h.tap(); await h.debounce();
  assert.equal(typeof complete, 'function');
  assert.match(container(h, 'head').content, /^\[Coding\]/);
  assert.match(container(h, 'body').content, /Session 0/);
  const page = h.pages.at(-1);
  await h.scroll('down'); await h.scroll('down');
  assert.match(h.upgrades.at(-1).content.split('\n')[2], /^>/);
  const upgradeCount = h.upgrades.length;
  complete(h.threads.map((thread, i) => i === 0 ? { ...thread, title: 'Updated session' } : thread));
  await h.flush();
  assert.equal(h.pages.at(-1), page);
  const refresh = h.upgrades.slice(upgradeCount);
  assert.match(refresh.find(write => write.containerName === 'body').content, /Updated session/);
  assert.equal(refresh.some(write => write.containerName === 'menu-cursor'), false);
  h.api.threads = async () => h.threads;
  await h.tap();
  assert.match(container(h, 'body').content, /All workspaces/);
});

test('Email opens on a moving-dot loading screen, then fills an incomplete page in place', async () => {
  const { fixture, requests } = mailFixture();
  const full = fixture.threads;
  let calls = 0;
  fixture.threads = async (filter, page) => {
    const result = await full(filter, page);
    // First answer: a cold bridge had one summary ready when its wait budget ran out.
    return ++calls === 1 ? { ...result, items: result.items.slice(0, 1), loading: true } : { ...result, loading: false };
  };
  const h = await moduleHarness({ capabilities: { modules: ['coding', 'email'] }, storage: { module: 'email' }, mail: fixture });
  // The first page drawn is the loading screen: Filter, then a busy row with no thread yet.
  const loadingPage = h.pages.at(-1);
  assert.match(loadingPage.textObject.find(c => c.containerName === 'body').content, /Loading email…/);
  assert.equal(loadingPage.textObject.find(c => c.containerName === 'menu-count').content.trim(), '');
  // Its rows were then rewritten in place: one thread and a 'Loading more' row with the dot.
  const rows = () => container(h, 'body').content.split('\n');
  assert.equal(rows().length, 3);
  assert.match(rows()[2], /Loading more…/);
  const dots = [...h.timers.values()];
  assert.equal(dots.length, 1);
  dots[0](); await h.flush();
  assert.match(container(h, 'menu-cursor').content.split('\n')[3], /·/);
  const pagesBefore = h.pages.length;
  assert.deepEqual([...h.timeouts.values()].map(t => t.delay), [1500]);
  await h.debounce(); await h.flush();
  assert.equal(requests.length, 2);
  assert.equal(h.pages.length, pagesBefore); // rows rewritten in place, no page rebuild
  assert.equal(rows().length, 9);
  assert.doesNotMatch(container(h, 'body').content, /Loading/);
  assert.equal(h.timers.size, 0); // the dot stops with the last busy row
  assert.equal(h.timeouts.size, 0); // complete: no further reads
});

test('a failed first Email load replaces the loading row with Email unavailable', async () => {
  const { fixture } = mailFixture();
  fixture.threads = async () => { throw new Error('offline'); };
  const h = await moduleHarness({ capabilities: { modules: ['coding', 'email'] }, storage: { module: 'email' }, mail: fixture });
  assert.match(container(h, 'body').content, /Email unavailable/);
  assert.doesNotMatch(container(h, 'body').content, /Loading/);
  assert.equal(h.timers.size, 0);
});

test('Email rows mark unread with / and read with -, and both fit the cursor gutter', () => {
  const { mailColumns } = mailModule({});
  const base = { account: 'work', id: 't', from: 'Desk', subject: 'Notes', date: Date.now(), count: 1 };
  assert.equal(mailColumns({ ...base, unread: true }).marker, '/');
  assert.equal(mailColumns({ ...base, unread: false }).marker, '-');
  const gutter = listExports.menuCursorText([{ marker: '-', title: '', right: '' }], 1).split('\n')[1];
  assert.equal(gutter, '>-');
  assert.ok(listExports.glassWidth(gutter) <= listExports.MENU_CURSOR.width);
});

test('row zero brackets the module name so it reads as a button', () => {
  const { moduleHeading, moduleButton } = listExports;
  assert.equal(moduleButton('Email'), '[Email]');
  assert.match(moduleHeading('Coding', 'Orca-glass 1.0.62'), /^\[Coding\]\s+Orca-glass 1\.0\.62$/);
});

const twoMailboxes = fixture => {
  fixture.accounts = async () => [{ id: 'work', short: 'W', address: 'work@example.test', ok: true }, { id: 'home', short: 'H', address: 'home@example.test', ok: true }];
  const threads = fixture.threads;
  fixture.threads = async (filter, page, size) => {
    const result = await threads(filter, page, size);
    return { ...result, items: result.items.map(item => ({ ...item, account: filter.some(key => key.startsWith('home:')) ? 'home' : 'work' })) };
  };
  return fixture;
};

test('a new mailbox starts with its Inbox, and saved picks of a known mailbox stay as chosen', () => {
  const { adoptNewAccounts, parseAccountPrefs, effectiveLabels } = mailModule({});
  const accounts = [{ id: 'work', short: 'W', ok: true }, { id: 'home', short: 'H', ok: true }];
  // First run after the update: work already has a pick, so only home gets its Inbox.
  const selected = new Set(['work:Label_1']);
  const prefs = parseAccountPrefs('');
  assert.equal(adoptNewAccounts(accounts, selected, prefs), true);
  assert.deepEqual([...selected], ['work:Label_1', 'home:INBOX']);
  assert.deepEqual([...prefs.known], ['work', 'home']);
  // A mailbox seen before keeps an empty pick list; nothing is re-added.
  selected.delete('home:INBOX');
  assert.equal(adoptNewAccounts(accounts, selected, prefs), false);
  assert.deepEqual([...selected], ['work:Label_1']);
  const restored = parseAccountPrefs(JSON.stringify({ off: ['home'], known: ['work', 'home'] }));
  assert.deepEqual([...restored.off], ['home']);
  assert.deepEqual([...effectiveLabels(new Set(['work:INBOX', 'home:INBOX']), restored.off)], ['work:INBOX']);
  assert.deepEqual([...parseAccountPrefs('not json').off], []);
});

test('two mailboxes: the row under row 0 toggles one mailbox at a time, shared with the phone', async () => {
  const { fixture, requests } = mailFixture();
  // Saved state from 1.0.62-1.0.66: work picked, home not seen yet. Home gets its Inbox but only
  // one mailbox stays on (Eugene, 2026-11-27: toggle, not filter).
  const h = await moduleHarness({ capabilities: { modules: ['coding', 'email'] }, storage: { module: 'email', 'mail-labels': '["work:INBOX"]' }, mail: twoMailboxes(fixture) });
  assert.deepEqual(requests.at(-1), { filter: ['work:INBOX'], page: 0, size: 7 });
  assert.equal(h.storage.get('mail-accounts'), '{"off":["home"],"known":["work","home"]}');
  const body = () => container(h, 'body').content.split('\n').map(row => row.trim());
  assert.deepEqual(body().slice(0, 2), ['work@example.test', 'Filter']);
  assert.equal(body().length, 9); // mailbox row, Filter, seven threads
  assert.doesNotMatch(container(h, 'menu-right').content, /\[W\]|\[H\]/);
  // Click the mailbox row: home's Inbox, rows rewritten in place, cursor kept on that row.
  const pages = h.pages.length;
  await h.scroll('down'); await h.tap(); await h.flush();
  assert.equal(h.pages.length, pages);
  assert.deepEqual(requests.at(-1), { filter: ['home:INBOX'], page: 0, size: 7 });
  assert.equal(h.storage.get('mail-accounts'), '{"off":["work"],"known":["work","home"]}');
  assert.equal(body()[0], 'home@example.test');
  assert.match(container(h, 'menu-cursor').content.split('\n')[1], /^>/);
  // The label picker lists only the mailbox on screen.
  await h.pickRow(2);
  const picker = container(h, 'body').content;
  assert.match(picker, /home@example\.test/);
  assert.doesNotMatch(picker, /work@example\.test|Unavailable/);
  await h.pickRow(0);
  // The phone shows and changes the same choice.
  const phone = h.phone();
  assert.equal(phone.mailAccount(), 'home');
  await phone.selectMailAccount('work');
  assert.deepEqual(requests.at(-1).filter, ['work:INBOX']);
  assert.equal(phone.mailAccount(), 'work');
});

test('a saved two-mailbox filter narrows to the first mailbox that was on', async () => {
  const { fixture, requests } = mailFixture();
  const h = await moduleHarness({ capabilities: { modules: ['coding', 'email'] },
    storage: { module: 'email', 'mail-labels': '["work:INBOX","home:INBOX"]', 'mail-accounts': '{"off":[],"known":["work","home"]}' }, mail: twoMailboxes(fixture) });
  assert.deepEqual(requests.at(-1).filter, ['work:INBOX']);
  assert.equal(h.storage.get('mail-accounts'), '{"off":["home"],"known":["work","home"]}');
  // home keeps its Inbox pick for when it is switched to.
  assert.equal(h.storage.get('mail-labels'), '["work:INBOX","home:INBOX"]');
});

test('one mailbox keeps its address as a plain heading in the picker', async () => {
  const { fixture } = mailFixture();
  fixture.accounts = async () => [{ id: 'work', short: 'W', address: 'work@example.test', ok: true }];
  const h = await moduleHarness({ capabilities: { modules: ['coding', 'email'] }, storage: { module: 'email' }, mail: fixture });
  await h.pickRow(1);
  assert.equal(container(h, 'body').content.split('\n')[1], 'work@example.test');
});

test('label search ignores case, numbering and punctuation and requires every word', () => {
  const { matchesMailLabel } = mailModule({});
  assert.equal(matchesMailLabel('6. FIELD—NOTES / Updates', 'notes, FIELD!'), true);
  assert.equal(matchesMailLabel('06. FIELD—NOTES / Updates', 'field updates'), true);
  assert.equal(matchesMailLabel('6. Field Notes', 'six field'), true);
  assert.equal(matchesMailLabel('20. Field Notes', 'twenty notes'), true);
  assert.equal(matchesMailLabel('12. Field Notes', 'two notes'), false);
  assert.equal(matchesMailLabel('6. Field Notes', 'six travel'), false);
  assert.equal(matchesMailLabel('Field Notes', 'field notes travel'), false);
});

test('label picker applies voice search on release, replaces and clears queries, and can toggle results', async () => {
  const { fixture } = mailFixture();
  fixture.labels = async () => [{ id: 'INBOX', name: 'Inbox', unread: 1 }, { id: 'Label_1', name: '6. Field Notes', unread: 2 }, { id: 'Label_2', name: '12. Field Notes', unread: 3 }];
  const h = await moduleHarness({ capabilities: { voice: true, modules: ['coding', 'email'] }, storage: { module: 'email' }, mail: fixture });
  await h.pickRow(1);
  const search = async query => {
    h.api.transcribe = async () => ({ text: query });
    h.press(); await h.flush();
    assert.match(container(h, 'voice-hint').content, /Listening/);
    h.audio(); h.release(); await h.flush();
  };
  await search('six field');
  assert.match(container(h, 'body').content, /^> Done\nSearch: six field\nW\n  \[ \] 6\. Field Notes \(2\)$/);
  await h.scroll('down'); await h.tap();
  assert.match(container(h, 'body').content, /> \[x\] 6\. Field Notes/);
  await search('twenty field');
  assert.match(container(h, 'body').content, /^> Done\nSearch: twenty field\nNo labels match$/);
  await h.back();
  assert.match(container(h, 'body').content, /12\. Field Notes/);
  await h.back();
  assert.match(container(h, 'head').content, /^\[Email\]/);
  assert.equal(h.sends.length, 0);
  const noVoice = await moduleHarness({ capabilities: { voice: false, modules: ['coding', 'email'] }, storage: { module: 'email' }, mail: fixture });
  await noVoice.pickRow(1); noVoice.press(); noVoice.release(); await noVoice.flush();
  assert.equal(noVoice.mic.length, 0);
  assert.match(container(noVoice, 'body').content, /Field Notes/);
});

test('mail list dates use the local day, and filter summaries show first label and extras', () => {
  const { mailDate, mailFilterSummary, mailFilterColumn } = mailModule({});
  const now = new Date(2026, 10, 26, 23, 30);
  assert.equal(mailDate(new Date(2026, 10, 26, 14, 5).getTime(), now), '14:05');
  assert.equal(mailDate(new Date(2026, 10, 25, 23, 59).getTime(), now), '25 Nov');
  assert.equal(mailFilterSummary(new Set(), new Map()), 'None');
  assert.equal(mailFilterSummary(new Set(['work:INBOX']), new Map()), 'Inbox');
  const names = new Map([['work:Label_1', 'Bulletins']]);
  assert.equal(mailFilterSummary(new Set(['work:Label_1', 'work:INBOX', 'work:Label_2']), names), 'Bulletins +2');
  const fitted = mailFilterColumn(`${'Long label '.repeat(12).trim()} +2`, 2);
  assert.match(fitted, /… \+2\]$/);
  assert.ok(listExports.glassWidth(fitted) <= listExports.MENU_RIGHT.width - 6);
});

test('the Email and Chat POSTs use their exact payload and never replay after a disconnect', async () => {
  const exports = {};
  const requests = [];
  let resolveCount = 0;
  const source = ts.transpileModule(readFileSync(new URL('../app/src/api.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { exports, require: () => ({}), TextEncoder, Uint8Array, AbortSignal,
    fetch: async (url, req) => { requests.push({ url, req }); throw new Error('synthetic disconnect'); } });
  exports.setConnection({ token: 'sample', base: 'http://127.0.0.1:12345', resolve: async () => { resolveCount++; return 'http://127.0.0.1:12346'; } });
  for (const [send, path, expected] of [
    [() => exports.api.mail.read('work', 'thread-123'), '/api/mail/read', { account: 'work', threadId: 'thread-123' }],
    [() => exports.api.chat.send('fixture-123', 'Synthetic reply.'), '/api/chat/send', { chatId: 'fixture-123', text: 'Synthetic reply.' }],
  ]) {
    const before = requests.length;
    await assert.rejects(send(), /Delivery uncertain/);
    assert.equal(requests.length - before, 1);
    const { url, req } = requests.at(-1);
    assert.equal(new URL(url).pathname, path);
    assert.equal(req.method, 'POST');
    assert.deepEqual(JSON.parse(req.body), expected);
  }
  assert.equal(resolveCount, 0);
});

test('mail reader assembles chronological headers and opens at the newest message start', () => {
  const { mailReaderText } = mailModule({});
  const { messages } = mailFixture();
  const { text, openingOffset } = mailReaderText({ subject: 'Field survey', messages: messages.toReversed() });
  assert.match(text, /^From: First Desk\nDate: [^\n]+\nSubject: Field survey\n\nEarlier notes\.\n\nFrom: Second Desk/);
  assert.match(text.slice(openingOffset), /^From: Second Desk\nDate: [^\n]+\nSubject: Field survey\n\nSurvey line 1\./);
});

test('Email restores its saved filter, skips account headings, and retries failed mark-read on reopen', async () => {
  const { fixture, requests } = mailFixture();
  let attempts = 0, h;
  const read = fixture.read;
  fixture.read = async () => {
    attempts++;
    assert.match(container(h, 'hint').content, /Pg2\/4$/);
    assert.match(container(h, 'body').content, /^From: Second Desk/);
    if (attempts === 1) throw new Error('synthetic disconnect');
    return read();
  };
  h = await moduleHarness({ capabilities: { modules: ['coding', 'email'] }, storage: { module: 'email', 'mail-labels': '["work:Label_1"]' }, mail: fixture });
  assert.match(container(h, 'menu-right').content, /\[Bulletins\]/);
  await h.pickRow(1);
  assert.equal(container(h, 'body').content.split('\n')[1], 'W');
  await h.scroll('down');
  assert.match(h.upgrades.at(-1).content, /> \[ \] Inbox/);
  await h.tap();
  assert.equal(h.storage.get('mail-labels'), '["work:Label_1","work:INBOX"]');
  await h.back();
  assert.deepEqual(requests.at(-1).filter, ['work:Label_1', 'work:INBOX']);
  await h.pickRow(2);
  assert.equal(attempts, 1);
  assert.equal(h.upgrades.findLast(update => update.containerName === 'voice').content, 'not marked read');
  assert.deepEqual(Array.from(h.pages.at(-1).menuObject.menuItems, item => item.itemName), ['Font: Native text', 'App Brightness: 15']);
  h.press(); h.release(); await h.flush();
  assert.equal(h.mic.length, 0);
  await h.scroll('up');
  assert.match(h.upgrades.findLast(update => update.containerName === 'body').content, /^From: First Desk/);
  await h.back();
  assert.match(container(h, 'menu-count').content, /1 unread$/);
  await h.pickRow(2); await h.back();
  assert.equal(attempts, 2);
  assert.match(container(h, 'menu-count').content, /0 unread$/);
});
const statusHint = h => h.upgrades.findLast(u => u.containerName === 'hint').content.trim();
const menuItems = h => h.pages.at(-1).listObject?.[0].itemContainer.itemName || h.pages.at(-1).textObject.find(c => c.containerName === 'body').content.split('\n').map(row => row.trim().replace(/^> ?/, '').replace(/^[*/?+◇]\s+/, ''));

test('every live terminal remains reachable through session-list pages', async () => {
  const h = await harness(40);
  const seen = new Set();
  for (let page = 0; page < 20; page++) {
    const labels = menuItems(h);
    labels.filter(s => s.includes('Session ')).forEach(s => seen.add(s));
    assert.ok(!labels.some(s => /^(Next|Previous) page$/.test(s)));
    if (seen.size === 40) break;
    for (let row = 0; row < labels.length; row++) await h.scroll('down');
  }
  assert.equal(seen.size, 40);
});

test('Filter by Agent stays in the list and contextual menu gets the three moved actions', async () => {
  const h = await harness();
  assert.deepEqual([...h.pages.at(-1).menuObject.menuItems].map(i => i.itemName), ['Refresh sessions', 'New Session', 'Usage']);
  const count = h.pages.length;
  await h.menu(9999); await h.system(4); await h.system(5);
  assert.equal(h.pages.length, count);
  assert.match(menuItems(h)[0], /Filter by Agent/);
  await h.pick(0);
  // No title row: the first row is Hermes Agent.
  assert.equal(h.pages.at(-1).textObject[0].content, ' ');
  assert.equal(menuItems(h)[0], 'Hermes Agent');
});

test('Filter by Agent lists Hermes Agent, then All Orca sessions and each Orca agent', async () => {
  const h = await harness();
  h.api.threads = async () => [
    { handle: 'codex', title: 'Codex conversation', agent: 'codex' },
    { handle: 'open', title: 'OpenCode worker', agent: 'opencode' },
    { handle: 'gemini', title: 'Gemini conversation', agent: 'gemini' },
  ];
  const saved = [];
  h.bridge.setLocalStorage = async (key, value) => { saved.push([key, value]); };
  await h.pick(0);
  // No title, divider or back row; double-click returns.
  assert.equal(JSON.stringify([...menuItems(h)]),
    JSON.stringify(['Hermes Agent', 'All Orca Sessions ✓', 'Claude', 'Codex', 'OpenCode', 'Gemini']));
  // The cursor opens on the ticked row.
  await h.scroll('up');
  assert.match(h.upgrades.at(-1).content.split('\n')[0], /^> Hermes Agent/);
  await h.scroll('down');
  assert.match(h.upgrades.at(-1).content.split('\n')[1], /^> All Orca Sessions/);
  await h.pick(4);
  assert.deepEqual(saved, [['view-provider', 'opencode']]);
  let items = menuItems(h);
  assert.equal(items.length, 3);
  assert.match(items[2], /OpenCode worker/);
  await h.pick(0);
  assert.match(menuItems(h)[4], /OpenCode ✓/);
  await h.pick(1);
  items = menuItems(h);
  assert.equal(items.length, 5);
  assert.equal(h.sends.length, 0);
});

test('saved provider filter restores even with no matching live sessions', async () => {
  const h = await harness(2, false, 'tap', 'claude');
  assert.equal(menuItems(h).length, 2);
  await h.pick(0);
  assert.equal(menuItems(h)[2], 'Claude ✓');
  assert.equal(h.sends.length, 0);
});

test('Hermes mixed models share one filter and saved reader uses confirmed voice flow', async () => {
  const h = await harness(2, true, 'hold');
  const models = ['GPT', 'Claude', 'Gemini', 'Qwen', 'Local', 'Custom', 'Other'];
  h.api.threads = async () => [
    ...models.map((model, i) => ({ handle: `hermes:${i}`, title: `Hermes ${model}`, agent: 'hermes',
      workspaceId: `profile-${i % 2}`, workspaceName: `Hermes profile ${i % 2}`, workspaceLabel: `profile ${i % 2}` })),
    { handle: 'codex', title: 'Codex regression', agent: 'codex' },
    { handle: 'claude', title: 'Claude regression', agent: 'claude' },
  ];
  await h.pick(0);
  assert.equal(JSON.stringify([...menuItems(h)]), JSON.stringify(['Hermes Agent', 'All Orca Sessions ✓', 'Claude', 'Codex']));
  // All Orca Sessions never includes Hermes.
  assert.ok(!menuItems(h).some(s => /^Hermes (?!Agent)/.test(s)));
  await h.pick(0);
  assert.equal(menuItems(h).length, 9);
  assert.ok(menuItems(h).slice(2).every(t => t.startsWith('Hermes ')));
  h.api.history = async () => ({ source: 'hermes-transcript', text: '> Exact Hermes saved answer' });
  await h.pick(2);
  assert.ok(h.pages.at(-1).textObject.some(c => c.content.includes('Exact Hermes saved answer')));
  h.press(); await h.flush(); h.audio(); h.release(); await h.flush();
  assert.equal(h.sends.length, 0);
  await h.tap();
  assert.deepEqual(h.sends, [{ handle: 'hermes:0', text: 'A voice test.' }]);
});

test('phone message requires review and cannot be sent to a newly selected session', async () => {
  const h = await harness();
  await h.pick(2);
  h.elements.get('reply-text').value = 'Please explain the change.';
  h.elements.get('reply-form').listeners.submit({ preventDefault() {} });
  await h.back();
  await h.pick(3);
  await h.elements.get('send-reply').listeners.click();
  assert.equal(h.sends.length, 0);
  h.elements.get('reply-text').value = 'A new sentence.';
  h.elements.get('reply-form').listeners.submit({ preventDefault() {} });
  await h.elements.get('send-reply').listeners.click();
  await h.elements.get('send-reply').listeners.click();
  assert.deepEqual(h.sends, [{ handle: 'terminal-1', text: 'A new sentence.' }]);
});

test('cancelling upstream microphone flow stops capture without restarting or sending', async () => {
  const h = await harness(2, true);
  await h.pick(2);
  h.press();
  await h.flush();
  assert.deepEqual(h.mic, [true]);
  await h.back();
  assert.deepEqual(h.mic, [true, false]);
  assert.equal(h.sends.length, 0);
});

test('slow polls do not overlap or overwrite a different session screen', async () => {
  const h = await harness();
  await h.pick(2);
  let finish, reads = 0;
  h.api.thread = () => { reads++; return new Promise(resolve => { finish = resolve; }); };
  const poll = [...h.timers.values()][0];
  const pending = poll();
  await h.flush();
  await poll();
  assert.equal(reads, 1);
  await h.back();
  h.api.thread = async () => ({ text: 'Other session' });
  await h.pick(3);
  finish({ text: 'Stale session output' });
  await pending;
  assert.equal(h.upgrades.length, 0);
  assert.equal(h.pages.at(-1).textObject[1].content, 'Other session');
});

test('working footer uses reported duration and animation never rewrites the conversation', async () => {
  const h = await harness();
  h.api.activity = async () => ({ state: 'working', elapsedSeconds: 812 });
  await h.pick(2);
  const pageCount = h.pages.length;
  const imagesBefore = h.images.length;
  await [...h.animations.values()][0]();
  assert.equal(h.pages.length, pageCount);
  assert.ok(h.images.length > imagesBefore);
  assert.ok(h.upgrades.every(u => ['voice', 'hint'].includes(u.containerName)));
  assert.equal(hintExports.compactDuration(812), '13m32s');
  assert.equal(hintExports.compactDuration(3725), '1h02m');
  assert.equal(hintExports.compactDuration(NaN), '');
  assert.equal(hintExports.statusRight(812, false, 'Pg7/8'), '13m32s [Tap&Hold for Input] Pg7/8');
  assert.equal(hintExports.statusRight(null, false, 'Pg7/8', t => t.length <= 12), '[T&H] Pg7/8');
  assert.equal(hintExports.statusRight(null, false, 'Pg7/8', t => t.length <= 6), 'Pg7/8');
  assert.equal(hintExports.statusRight(null, true, 'Pg1/2'), '[Click:choices] Pg1/2');
});

test('working words last five seconds and Braille patterns are distinct', () => {
  assert.match(statusExports.readerStatus('working', 0, 0), /Processing\.$/);
  assert.match(statusExports.readerStatus('working', 1, 500), /Processing\.\.$/);
  assert.match(statusExports.readerStatus('working', 2, 1000), /Processing\.\.\.$/);
  assert.match(statusExports.readerStatus('working', 0, 4999), /Processing/);
  assert.match(statusExports.readerStatus('working', 0, 5000), /Thinking\.$/);
  assert.equal(new Set(statusExports.SPINNER.map(s => JSON.stringify(statusExports.statusPixels(s)))).size, 10);
});

test('hold opens a full-screen voice page; release reviews; only explicit send submits once', async () => {
  const h = await harness(2, true, 'hold');
  await h.pick(2);
  const readerBuilds = h.pages.length;
  h.press(); await h.flush();
  const voicePage = h.pages.at(-1);
  assert.equal(h.pages.length, readerBuilds + 1);
  assert.equal(voicePage.containerTotalNum, 4);
  assert.equal(voicePage.textObject.find(c => c.containerName === 'voice-hint').content, 'Listening… release to review');
  h.audio(); h.release(); await h.flush();
  assert.deepEqual(h.mic, [true, false]);
  assert.equal(h.transcriptions.length, 1);
  assert.equal(h.sends.length, 0);
  assert.match(voiceBody(h), /A voice test\./);
  assert.equal(h.upgrades.findLast(u => u.containerName === 'voice-hint').content, 'Tap to send / Double tap to cancel');
  await h.tap();
  assert.equal(h.sends.length, 1);
  assert.ok(h.pages.at(-1).textObject.some(c => c.containerName === 'hint'), 'send returns to the chat');
  h.release(); await h.flush();
  assert.equal(h.sends.length, 1);
});

test('cancelling final transcription prevents late sending', async () => {
  const h = await harness(2, true, 'hold');
  await h.pick(2);
  h.press();
  await h.flush();
  h.audio();
  let finish;
  h.api.transcribe = () => new Promise(resolve => { finish = resolve; });
  h.release();
  await h.flush();
  await h.back();
  finish({ text: 'Must not send' });
  await h.flush();
  assert.equal(h.sends.length, 0);
});

test('release before the recording screen is ready never leaves the microphone running', async () => {
  const h = await harness(2, true, 'hold');
  await h.pick(2);
  h.press();
  h.release();
  await h.flush();
  assert.equal(h.mic.includes(true), false);
});

test('text pages preserve long Unicode output within row and byte limits', () => {
  const text = '語'.repeat(1000);
  const pages = textExports.textPages(text);
  assert.equal(pages.join('').replaceAll('\n', ''), text);
  assert.ok(pages.every(p => new TextEncoder().encode(p).length <= 999 && p.split('\n').length <= 8));
});

test('reader flips nine-row pages, shows position, clamps ends and freezes incoming text', async () => {
  const h = await harness();
  const output = Array.from({ length: 30 }, (_, i) => `Line ${i}`).join('\n');
  h.api.thread = async () => ({ text: output });
  await h.pick(2);
  assert.equal(h.pages.at(-1).textObject[1].content, 'Line 27\nLine 28\nLine 29');
  assert.match(h.pages.at(-1).textObject.find(c => c.containerName === 'hint').content.trim(), /Pg4\/4$/);
  const body = () => h.upgrades.findLast(u => u.containerName === 'body')?.content;
  await h.scroll('up');
  assert.equal(body(), Array.from({ length: 9 }, (_, i) => `Line ${i + 18}`).join('\n'));
  assert.match(statusHint(h), /Pg3\/4$/);
  await h.scroll('up'); await h.scroll('up');
  assert.match(statusHint(h), /Pg1\/4$/);
  const writes = h.upgrades.length;
  await h.scroll('up');
  h.api.thread = async () => ({ text: 'Updated output' });
  await [...h.timers.values()][0]();
  assert.equal(h.upgrades.length, writes);
  const count = h.pages.length;
  await h.tap();
  assert.equal(h.pages.length, count);
  assert.equal(h.upgrades.length, writes);
  await h.scroll('down');
  assert.equal(body(), Array.from({ length: 9 }, (_, i) => `Line ${i + 9}`).join('\n'));
});

test('Unicode sections preserve all text within native update limit', () => {
  const original = '語🙂abc'.repeat(1000);
  const sections = textExports.textSections(original);
  assert.equal(sections.join(''), original);
  assert.ok(sections.every(s => new TextEncoder().encode(s).length <= 900 && !/[\uD800-\uDBFF]$/.test(s)));
});





test('previews serialize requests; release waits for final text before review', async () => {
  const h = await harness(2, true, 'hold');
  await h.pick(2); h.press(); await h.flush(); h.audio();
  let finish, requests = 0;
  h.api.transcribe = () => { requests++; return new Promise(resolve => { finish = resolve; }); };
  const preview = [...h.timers.values()][0];
  preview(); preview();
  assert.equal(requests, 1);
  finish({ text: 'First words' }); await h.flush();
  assert.equal(h.upgrades.at(-1).content, 'First words');
  assert.equal(h.sends.length, 0);
  h.audio(); preview(); h.release(); await h.flush();
  assert.equal(h.sends.length, 0);
  finish({ text: 'First words and final words' }); await h.flush();
  assert.equal(requests, 2);
  assert.equal(h.sends.length, 0);
  assert.match(voiceBody(h), /First words and final words/);
  await h.tap();
  assert.deepEqual(h.sends, [{ handle: 'terminal-0', text: 'First words and final words' }]);
});

test('cancel during preview prevents late captions and input', async () => {
  const h = await harness(2, true, 'hold');
  await h.pick(2); h.press(); await h.flush(); h.audio();
  let finish;
  h.api.transcribe = () => new Promise(resolve => { finish = resolve; });
  [...h.timers.values()][0](); await h.back();
  finish({ text: 'Late caption' }); await h.flush();
  assert.ok(h.pages.at(-1).textObject.some(c => c.containerName === 'hint'), 'cancel returns to the chat');
  assert.ok(h.upgrades.every(u => !u.content.includes('Late caption')));
  assert.equal(h.sends.length, 0);
});

test('saved history is reachable in both directions without dropped or renumbered nested items', async () => {
  const h = await harness();
  const text = '> Open items:\n' + Array.from({ length: 19 }, (_, i) => `  ${i + 1}. Item ${i + 1}`).join('\n') + '\n  - Group\n    1. Nested one\n    2. Nested two';
  h.api.history = async () => ({ text, source: 'claude-transcript' });
  await h.pick(2);
  const expected = [...readerPageText(text, t => textExports.glassTextWidth(t), 552, 9)];
  // A single response opens at its top (page 1); page down through the rest.
  const seen = [h.pages.at(-1).textObject[1].content];
  const pageCount = h.pages.length;
  for (let i = 1; i < expected.length; i++) {
    await h.scroll('down');
    seen.push(h.upgrades.findLast(u => u.containerName === 'body').content);
  }
  assert.deepEqual(seen, expected);
  assert.equal(seen.join('\n'), text);
  for (let i = 1; i <= 19; i++) assert.ok(seen.join('\n').includes(`  ${i}. Item ${i}`));
  for (let i = 1; i < expected.length; i++) await h.scroll('up');
  assert.equal(h.upgrades.findLast(u => u.containerName === 'body').content, expected[0]);
  const writes = h.upgrades.length;
  h.api.history = async () => ({ text: text + '\nNew output', source: 'claude-transcript' });
  await [...h.timers.values()][0]();
  assert.equal(h.upgrades.length, writes);
  assert.equal(h.pages.length, pageCount);
  assert.equal(h.sends.length, 0);
});

test('rapid reader swipes serialize writes and never rebuild the page or send input', async () => {
  const h = await harness();
  h.api.thread = async () => ({ text: Array.from({ length: 30 }, (_, i) => `Line ${i}`).join('\n') });
  await h.pick(2);
  let release;
  const original = h.bridge.textContainerUpgrade;
  h.bridge.textContainerUpgrade = value => {
    if (value.containerName !== 'body') return original(value);
    h.bridge.textContainerUpgrade = original;
    return new Promise(resolve => { release = () => { original(value); resolve(true); }; });
  };
  const rebuilds = h.pages.length;
  await h.scroll('up'); await h.scroll('up'); await h.scroll('up');
  release(); await h.flush();
  assert.equal(h.upgrades.findLast(u => u.containerName === 'body').content, Array.from({ length: 9 }, (_, i) => `Line ${i}`).join('\n'));
  assert.match(statusHint(h), /Pg1\/4$/);
  assert.equal(h.pages.length, rebuilds);
  assert.equal(h.sends.length, 0);
});

test('reader page wrapping retains every character with proportional widths and Unicode budgets', () => {
  const measure = t => [...t].reduce((n, c) => n + (c === 'W' ? 24 : 9), 0);
  const text = Array.from({ length: 19 }, (_, i) => `  ${i + 1}. WWW item ${i + 1} with wide words and punctuation; ` + '🙂'.repeat(100)).join('\n');
  const pages = [...readerPageText(text, measure)];
  // Wrapping adds hanging-indent spaces and drops wrap-point spaces only.
  assert.equal(pages.join('').replace(/\s/g, ''), text.replace(/\s/g, ''));
  assert.ok(pages.every(page => page.split('\n').length <= 6 && new TextEncoder().encode(page).length <= 900));
  assert.ok(pages.every(page => page.split('\n').every(row => measure(row) <= 550)));
  assert.ok(pages.some(page => page.includes('19.')));
});

test('hold starts directly from chat even with a saved tap preference, without menu checks', async () => {
  const h = await harness(2, true, 'tap');
  await h.pick(2);
  const before = h.pages.length;
  h.api.thread = async () => { throw new Error('No pre-record menu lookup should run'); };
  h.api.capabilities = async () => { throw new Error('No pre-record capability lookup should run'); };
  h.press(); await h.flush();
  assert.deepEqual(h.mic, [true]);
  assert.equal(h.pages.length, before + 1);
  assert.equal(h.pages.at(-1).listObject, undefined);
  assert.equal(h.pages.at(-1).textObject.find(c => c.containerName === 'voice-hint').content, 'Listening… release to review');
  await h.back();
  assert.equal(h.sends.length, 0);
});

test('double-click discards a finished voice draft without sending', async () => {
  const h = await harness(2, true, 'hold');
  await h.pick(2); h.press(); await h.flush(); h.audio(); h.release(); await h.flush();
  assert.equal(voiceBody(h), 'A voice test.');
  await h.back();
  assert.equal(h.sends.length, 0);
  assert.equal(h.pages.at(-1).textObject[1].content, 'Content terminal-0');
  h.press(); await h.flush();
  assert.equal(h.mic.at(-1), true);
  await h.back();
});


test('voice send and cancel both return to the newest chat page and resume live updates', async () => {
  for (const send of [true, false]) {
    const h = await harness(2, true, 'hold');
    const text = Array.from({ length: 30 }, (_, i) => `Line ${i}`).join('\n');
    h.api.history = async () => ({ text, source: 'codex-transcript' });
    await h.pick(2); await h.scroll('up'); await h.scroll('up');
    assert.match(statusHint(h), /Pg2\/4$/);
    h.press(); await h.flush(); h.audio(); h.release(); await h.flush();
    assert.equal(h.sends.length, 0);
    if (send) await h.tap(); else await h.back();
    await h.flush();
    const page = h.pages.at(-1);
    assert.equal(page.textObject.find(c => c.containerName === 'body').content, 'Line 27\nLine 28\nLine 29');
    assert.match(page.textObject.find(c => c.containerName === 'hint').content.trim(), /Pg4\/4$/);
    assert.equal(h.sends.length, send ? 1 : 0);
    assert.equal(h.timers.size, 1);
    h.api.history = async () => ({ text: `${text}\nLine 30`, source: 'codex-transcript' });
    await [...h.timers.values()][0]();
    assert.equal(h.upgrades.findLast(u => u.containerName === 'body').content, 'Line 27\nLine 28\nLine 29\nLine 30');
  }
});

test('a rejected voice page keeps the chat, never starts the microphone and resumes polling', async () => {
  const h = await harness(2, true, 'hold');
  await h.pick(2);
  const rebuild = h.bridge.rebuildPageContainer;
  h.bridge.rebuildPageContainer = async p => p.textObject.some(c => c.containerName === 'voice-body') ? false : rebuild(p);
  h.press(); await h.flush();
  assert.notEqual(h.mic.at(-1), true);
  assert.match(h.elements.get('diag').textContent, /rejected/);
  assert.equal(h.sends.length, 0);
  assert.equal(h.timers.size, 1);
});

test('bottom status changes while reading is paused without rewriting the conversation', async () => {
  const h = await harness();
  await h.pick(2);
  const pages = h.pages.length;
  await h.scroll('up');
  h.api.activity = async () => ({ state: 'working' });
  await [...h.timers.values()][0]();
  assert.equal(h.upgrades.at(-1).content, '    Processing.');
  assert.deepEqual(Object.keys(h.upgrades.at(-1)).sort(), ['containerID', 'containerName', 'content', 'textColor'].sort());
  h.api.activity = async () => ({ state: 'waiting' });
  await [...h.timers.values()][0]();
  assert.equal(h.upgrades.findLast(u => u.containerName === 'voice').content, '/Waiting');
  assert.ok(h.upgrades.every(u => ['voice', 'hint'].includes(u.containerName)));
  assert.equal(h.pages.length, pages);
});

test('initial reader status is fetched before rendering rather than waiting for phone timers', async () => {
  const h = await harness();
  h.api.activity = async () => ({ state: 'working' });
  await h.pick(2);
  assert.equal(h.pages.at(-1).textObject.find(c => c.containerName === 'voice').content, '    Processing.');
});

test('late activity cannot write to the voice page; cancel restores status and live polling', async () => {
  const h = await harness(2, true, 'hold');
  await h.pick(2);
  h.api.activity = async () => ({ state: 'working' });
  await [...h.timers.values()][0]();
  let finish;
  h.api.activity = () => new Promise(resolve => { finish = resolve; });
  const pending = [...h.timers.values()][0]();
  h.press(); await h.flush();
  const writes = h.upgrades.length;
  finish({ state: 'waiting' });
  await pending;
  assert.equal(h.upgrades.length, writes);
  await h.back(); await h.flush();
  assert.equal(h.pages.at(-1).textObject.find(c => c.containerName === 'voice').content, '    Processing.');
  h.api.activity = async () => ({ state: 'waiting' });
  await [...h.timers.values()][0]();
  assert.equal(h.upgrades.findLast(u => u.containerName === 'voice').content, '/Waiting');
});

test('saved history losing its association falls back to live output and keeps updating', async () => {
  const h = await harness();
  h.api.history = async () => ({ text: 'Saved conversation', source: 'codex-transcript' });
  await h.pick(2);
  h.api.history = async () => ({ text: 'Raw buffer', source: 'terminal-buffer' });
  h.api.thread = async () => ({ text: 'New live reply' });
  await [...h.timers.values()][0]();
  assert.equal(h.upgrades.findLast(u => u.containerName === 'body').content, 'New live reply');
  h.api.history = async () => { throw new Error('Must stay on the live source'); };
  h.api.thread = async () => ({ text: 'Next live reply' });
  await [...h.timers.values()][0]();
  assert.equal(h.upgrades.findLast(u => u.containerName === 'body').content, 'Next live reply');
});

test('a rejected live text update is retried instead of marking unseen text as displayed', async () => {
  const h = await harness();
  await h.pick(2);
  h.api.thread = async () => ({ text: 'Fresh reply' });
  const original = h.bridge.textContainerUpgrade;
  let attempts = 0;
  h.bridge.textContainerUpgrade = async value => {
    if (value.containerName === 'body' && ++attempts === 1) return false;
    return original(value);
  };
  await [...h.timers.values()][0]();
  assert.match(h.elements.get('diag').textContent, /Retrying/);
  await [...h.timers.values()][0]();
  assert.equal(attempts, 2);
  assert.equal(h.upgrades.findLast(u => u.containerName === 'body').content, 'Fresh reply');
});

 test('session click does nothing without a detected numbered prompt', async () => {
  const h = await harness();
  await h.pick(2);
  const count = h.pages.length;
  h.api.thread = async () => { throw new Error('Click must not read or open a choice menu'); };
  await h.tap();
  assert.equal(h.pages.length, count);
  assert.equal(h.upgrades.length, 0);
  assert.equal(h.sends.length, 0);
  const frame = h.pages.at(-1).textObject.find(c => c.containerName === 'frame');
  const divider = h.pages.at(-1).textObject.find(c => c.containerName === 'divider');
  assert.equal(frame.borderColor, 15);
  assert.equal(divider.borderColor, 15);
  assert.equal(frame.borderWidth, 1);
  assert.equal(divider.borderWidth, 1);
  assert.equal(divider.height, 1);
  assert.equal(h.pages.at(-1).textObject.find(c => c.containerName === 'voice').content, '/Status unknown');
});

test('reader and voice pages use contiguous IDs; voice page has nine transcript rows and one instruction row', async () => {
  const h = await harness(2, true, 'hold');
  await h.pick(2);
  const reader = h.pages.at(-1);
  assert.equal(reader.containerTotalNum, 7);
  const list = values => JSON.stringify([...values]);
  assert.equal(list(reader.imageObject.map(c => c.containerName)), list(['status-icon']));
  assert.equal(list([...reader.textObject, ...reader.imageObject].map(c => c.containerID).sort((a, b) => a - b)), list([1, 2, 3, 4, 5, 6, 7]));
  assert.equal(list([...reader.textObject, ...reader.imageObject].map(c => c.zOrderIndex).sort((a, b) => a - b)), list([0, 1, 2, 3, 4, 5, 6]));
  h.press(); await h.flush(); h.audio(); h.release(); await h.flush();
  const voice = h.pages.at(-1);
  assert.equal(list(voice.textObject.map(c => c.containerID).sort((a, b) => a - b)), list([1, 2, 3, 4]));
  const body = voice.textObject.find(c => c.containerName === 'voice-body');
  const hint = voice.textObject.find(c => c.containerName === 'voice-hint');
  const divider = voice.textObject.find(c => c.containerName === 'voice-divider');
  assert.equal(body.height, 243);
  assert.equal(body.isEventCapture, 1);
  assert.ok(body.yPosition + body.height < divider.yPosition);
  assert.ok(divider.yPosition + divider.height <= hint.yPosition);
  assert.equal(hint.height, 28);
  assert.ok(hint.yPosition + hint.height <= 288);
  await h.back();
  assert.equal(h.images.filter(i => i.containerName.startsWith('voice-border')).length, 0);
});

test('compact session menu uses native text and one update per cursor move', async () => {
  const h = await harness();
  const pages = h.pages.length;
  assert.equal(h.pages.at(-1).imageObject, undefined);
  assert.equal(h.pages.at(-1).listObject, undefined);
  assert.equal(h.pages.at(-1).textObject.find(c => c.containerName === 'menu-input').isEventCapture, 1);
  assert.ok(h.pages.at(-1).textObject.filter(c => c.containerName !== 'menu-input').every(c => c.isEventCapture === 0));
  assert.ok(h.images.every(i => i.containerName.startsWith('menu-spin')));
  assert.equal(h.animations.size, 0);
  const columns = h.pages.at(-1).textObject;
  assert.equal(columns.find(c => c.containerName === 'menu-count').xPosition, 300);
  assert.equal(columns.find(c => c.containerName === 'head').height, 28);
  assert.equal(columns.find(c => c.containerName === 'body').yPosition, 28);
  assert.equal(columns.find(c => c.containerName === 'menu-right').xPosition, 328);
  assert.equal(columns.find(c => c.containerName === 'body').content.split('\n')[0], ' Filter by Agent');
  assert.equal(columns.find(c => c.containerName === 'body').xPosition, 28);
  const actionRows = columns.find(c => c.containerName === 'body').content.split('\n').slice(0, 4);
  assert.ok(actionRows.every(row => /^ {1}\S/.test(row)));
  assert.ok(!actionRows.join(' ').includes('Usage'));
  assert.match(columns.find(c => c.containerName === 'menu-right').content.split('\n')[0], /All Orca sessions/);
  assert.equal(columns.find(c => c.containerName === 'menu-right').content.split('\n')[2].trim(), '[Codex]');
  assert.equal(h.pages.at(-1).containerTotalNum, 6);
  const all = [...columns];
  assert.deepEqual(all.map(c => c.zOrderIndex).sort((a, b) => a - b), [0,1,2,3,4,5]);
  assert.deepEqual(all.map(c => c.containerID).sort((a, b) => a - b), [1,2,3,4,5,6]);
  await h.scroll('down');
  assert.equal(h.upgrades.length, 1);
  assert.equal(h.upgrades[0].containerName, 'menu-cursor');
  assert.equal(h.upgrades[0].content.split('\n')[1].trimStart(), '>*');
  await h.scroll('down');
  assert.equal(h.pages.length, pages);
  await h.scroll('down');
  await h.tap();
  assert.equal(h.pages.at(-1).textObject[1].content, 'Content terminal-0');
});

test('reader has no title row, nine chat rows, a divider and one status row', async () => {
  const h = await harness();
  await h.pick(2);
  const page = h.pages.at(-1);
  const body = page.textObject.find(c => c.containerName === 'body');
  const voice = page.textObject.find(c => c.containerName === 'voice');
  const hint = page.textObject.find(c => c.containerName === 'hint');
  const divider = page.textObject.find(c => c.containerName === 'divider');
  assert.equal(page.textObject.find(c => c.containerName === 'head').content, ' ');
  assert.equal(body.yPosition, 4);
  assert.equal(body.height, 243);
  assert.equal(body.xPosition, 8);
  assert.equal(body.width, 560);
  assert.equal(body.paddingLength, 0);
  assert.ok(body.yPosition + body.height < divider.yPosition);
  for (const row of [voice, hint]) {
    assert.equal(row.height, 28);
    assert.ok(divider.yPosition + divider.height <= row.yPosition);
    assert.ok(row.yPosition + row.height < 288);
  }
});

test('rapid native-text menu swipes coalesce instead of queuing every redraw', async () => {
  const h = await harness(4);
  let finish;
  const original = h.bridge.textContainerUpgrade;
  h.bridge.textContainerUpgrade = value => { h.bridge.textContainerUpgrade = original; return new Promise(resolve => { finish = () => { original(value); resolve(true); }; }); };
  await h.scroll('down'); await h.scroll('down'); await h.scroll('down'); await h.scroll('down'); await h.scroll('down');
  finish(); await h.flush();
  assert.equal(h.upgrades.length, 2);
  assert.equal(h.upgrades.at(-1).content.split('\n')[5].trimStart(), '>?');
  assert.ok(h.images.every(i => i.containerName.startsWith('menu-spin')));
});

test('startup uses a minimal native page and recovers an already-consumed startup', async () => {
  const h = await harness(2, false, 'tap', '', 1);
  assert.equal(h.pages.length, 3);
  assert.equal(h.pages[0].containerTotalNum, 2);
  assert.equal(h.pages[1].containerTotalNum, 2);
  assert.equal(h.pages[2].containerTotalNum, 6);
});

test('hardware rejecting aligned layout gets an operable compact fallback', async () => {
  const h = await harness(2, false, 'tap', '', 0, true);
  assert.equal(h.pages[0].containerTotalNum, 2);
  assert.equal(h.pages[1].containerTotalNum, 6);
  assert.equal(h.pages.at(-1).containerTotalNum, 3);
  assert.equal(h.pages.at(-1).imageObject, undefined);
  assert.match(h.elements.get('diag').textContent, /compact compatibility menu active/);
  await h.scroll('down');
  assert.equal(h.upgrades.at(-1).containerName, 'body');
  await h.scroll('down');
  await h.scroll('down');
  await h.tap();
  assert.equal(h.pages.at(-1).textObject[1].content, 'Content terminal-0');
  await h.back();
  assert.equal(h.pages.at(-1).containerTotalNum, 3);
  assert.equal(h.pages.filter(p => p.containerTotalNum === 6).length, 1);
});

test('voice review shows a multi-line transcript on the full-screen page', async () => {
  const h = await harness(2, true, 'hold');
  await h.pick(2);
  h.api.transcribe = async () => ({ text: 'First line.\nSecond line.\nThird line.' });
  h.press(); await h.flush(); h.audio(); h.release(); await h.flush();
  assert.equal(voiceBody(h), 'First line.\nSecond line.\nThird line.');
  await h.tap();
  assert.equal(h.sends.length, 1);
});

test('menu activity polling starts a spinner after a session becomes busy', async () => {
  const h = await harness();
  h.api.threads = async () => [{ handle: 'terminal-0', title: 'Session 0', agent: 'codex', state: 'busy' }];
  await [...h.timers.values()].at(-1)(); await h.flush();
  const before = h.upgrades.filter(i => i.containerName === 'menu-cursor').at(-1).content;
  await [...h.timers.values()][0](); await h.flush();
  const after = h.upgrades.filter(i => i.containerName === 'menu-cursor').at(-1).content;
  assert.notEqual(before, after);
  assert.equal(h.images.length, 0);
  const bodyWrites = h.upgrades.filter(u => u.containerName === 'body');
  assert.equal(bodyWrites.length, 0);
  assert.match(after.split('\n')[3], /^[ >][ ·]{3}$/);
});

test('locking the phone keeps the open chat polling', async () => {
  const h = await harness();
  await h.pick(2);
  const running = h.timers.size;
  assert.ok(running >= 1);
  h.pagehide();
  assert.equal(h.timers.size, running);
});

test('a recreated page reopens the chat that was on screen', async () => {
  const h = await harness(2, false, 'tap', '', 0, false, '', '', 'terminal-1');
  assert.equal(h.pages.at(-1).textObject.find(c => c.containerName === 'body').content, 'Content terminal-1');
  assert.ok(h.timers.size >= 1);
});

test('system exit stops menu activity polling and marker animation', async () => {
  const h = await harness();
  assert.ok(h.timers.size >= 2);
  await h.system(7);
  assert.equal(h.timers.size, 0);
  assert.equal(h.animations.size, 0);
});

test('session menu never requests marker images', async () => {
  const h = await harness(2, false, 'tap', '', 0, 'images');
  assert.equal(h.pages.at(-1).containerTotalNum, 6);
  assert.equal(h.pages.at(-1).imageObject, undefined);
  assert.ok(h.pages.at(-1).textObject.some(c => c.containerName === 'menu-right'));
  assert.match(h.elements.get('menu-layout').textContent, /animated dots/);
  await h.scroll('down');
  assert.equal(h.upgrades.at(-1).containerName, 'menu-cursor');
});


test('action, idle and working titles share one fixed leading space', () => {
  const rows = [
    { title: 'Filter by Agent', marker: '*' },
    { title: 'Usage', marker: '◊' },
    { title: 'Idle', marker: '/', handle: 'idle', busy: false },
    { title: 'Working', marker: '', handle: 'busy', busy: true },
  ];
  assert.equal(listExports.menuNativeText(rows), ' Filter by Agent\n Usage\n Idle\n Working');
  for (let frame = 0; frame < 3; frame++) {
    const markers = listExports.menuCursorText(rows, 4, frame).split('\n');
    assert.equal(markers.length, rows.length + 1);
    assert.equal(markers[4].length, 4);
    assert.equal(markers[4][0], '>');
  }
});


test('contextual actions refresh roster, open workspace picker and display usage', async () => {
  const h = await harness();
  h.api.threads = async () => [{ handle: 'terminal-0', title: 'Renamed session', agent: 'codex', state: 'idle' }];
  await h.menu(1001);
  assert.match(menuItems(h)[2], /Renamed session/);
  h.api.workspaces = async () => [{ id: 'fixture', name: 'Fixture workspace' }];
  await h.menu(1002);
  assert.equal(h.pages.at(-1).textObject[0].content, 'New 1/4 Workspace');
  assert.equal(menuItems(h)[0], 'Fixture workspace');
  assert.equal(h.pages.at(-1).menuObject, undefined);
  await h.back();
  h.api.usage = async () => ({ codex: { provider: 'codex', status: 'ok', weekly: { usedPercent: 25, resetDescription: 'tomorrow' } } });
  await h.menu(1003);
  assert.equal(h.pages.at(-1).textObject[0].content, 'Usage');
  assert.match(h.pages.at(-1).textObject[1].content, /25%/);
  await h.back(); await h.pick(2);
  // The reader's own menu only switches text size; session-list actions do nothing there.
  assert.equal(JSON.stringify(h.pages.at(-1).menuObject.menuItems.map(i => [i.itemID, i.itemName])),
    JSON.stringify([[1101, 'Font: Native text'], [1107, 'App Brightness: 15']]));
  const pages = h.pages.length;
  await h.menu(1002);
  assert.equal(h.pages.length, pages);
  assert.equal(h.sends.length, 0);
});


test('Usage renders Claude windows and Cursor monthly allowance without mislabelling', async () => {
  const h = await harness();
  h.api.usage = async () => ({
    claude: { provider: 'claude', status: 'ok', session: { usedPercent: 3, resetDescription: '9:50 AM' }, weekly: { usedPercent: 2, resetDescription: '1:00 PM' } },
    cursor: { provider: 'cursor', status: 'ok', monthly: { usedPercent: 2.020596, resetDescription: 'Nov 5' } },
  });
  await h.menu(1003);
  const text = h.pages.at(-1).textObject[1].content;
  assert.match(text, /Claude\n  5h 3%/);
  assert.match(text, /Cursor\n  Monthly 2% \(Nov 5\)/);
  assert.ok(!text.includes('2.020596'));
});


test('Claude verified saved chat opens and polls even when the live tool screen is empty', async () => {
  const h = await harness();
  h.api.thread = async () => ({ text: '' });
  h.api.history = async () => ({ text: '/ Question\n> Earlier answer', source: 'claude-transcript' });
  await h.pick(2);
  assert.ok(h.pages.at(-1).textObject.some(c => c.content.includes('Earlier answer')));
  h.api.history = async () => ({ text: '/ Question\n> Earlier answer\n> Latest answer', source: 'claude-transcript' });
  for (const fn of h.timers.values()) await fn();
  assert.ok(h.upgrades.some(u => u.content.includes('Latest answer')));
});

const prompt = { id: 'question-a', question: 'Which test approach?', options: [
  { value: '1', label: 'First approach', description: 'Detailed first approach.' },
  { value: '2', label: 'Second approach' }, { value: '3', label: 'Type something.' },
] };

test('Claude progress keeps the public reply visible and freezes body updates on swipe', async () => {
  const h = await harness();
  h.threads[0].agent = 'claude';
  h.api.activity = async () => ({ state: 'working' });
  h.api.thread = async () => ({ text: '', progress: 'Reading files' });
  h.api.history = async () => ({ source: 'claude-transcript', text: '> Earlier reply' });
  await h.pick(2);
  assert.ok(h.pages.at(-1).textObject.some(c => c.content.includes('> Earlier reply\n~ Reading files')));
  h.api.thread = async () => ({ text: '', progress: 'Running a command' });
  await [...h.timers.values()][0]();
  assert.ok(h.upgrades.some(u => u.containerName === 'body' && u.content.includes('Earlier reply\n~ Running a command')));
  await h.scroll('up');
  const writes = h.upgrades.filter(u => u.containerName === 'body').length;
  h.api.thread = async () => ({ text: '', progress: 'Editing a file' });
  await [...h.timers.values()][0]();
  assert.equal(h.upgrades.filter(u => u.containerName === 'body').length, writes);
});

test('a newly detected prompt enables Click choices and confirmation sends only the selected number', async () => {
  const h = await harness();
  await h.pick(2);
  h.api.thread = async () => ({ text: 'Public reply', menu: prompt });
  await [...h.timers.values()][0]();
  await h.tap();
  assert.deepEqual([...h.pages.at(-1).listObject[0].itemContainer.itemName], ['1. First approach', '2. Second approach', '3. Type something.']);
  await h.pick(0);
  assert.ok(h.pages.at(-1).textObject.some(c => c.content.includes('Detailed first approach.')));
  assert.equal(h.choices.length, 0);
  h.api.thread = async () => ({ text: 'Reply after choice', menu: null });
  await h.tap();
  await h.flush();
  assert.deepEqual(h.choices, [{ handle: 'terminal-0', menuId: 'question-a', value: '1' }]);
  assert.equal(h.sends.length, 0);
  const count = h.pages.length;
  await h.tap();
  assert.equal(h.pages.length, count);
});

test('spoken choice is reviewed, then validated against the captured prompt without a free-text send', async () => {
  const h = await harness(2, true, 'hold');
  h.api.thread = async () => ({ text: '', menu: prompt });
  h.api.transcribe = async () => ({ text: 'Option two.' });
  await h.pick(2);
  h.press(); await h.flush(); h.audio(); h.release();
  await h.flush(); await h.flush();
  assert.ok(h.upgrades.some(u => u.containerName === 'voice-body' && u.content === '2. Second approach'));
  assert.equal(h.choices.length, 0);
  await h.tap(); await h.flush();
  assert.deepEqual(h.choices, [{ handle: 'terminal-0', menuId: 'question-a', value: '2' }]);
  assert.equal(h.sends.length, 0);
});

test('stale spoken choices fail without sending a sentence or automatically retrying', async () => {
  const h = await harness(2, true, 'hold');
  h.api.thread = async () => ({ text: '', menu: prompt });
  h.api.transcribe = async () => ({ text: 'One' });
  let attempts = 0;
  h.api.choice = async () => { attempts++; throw new Error('Question changed. Reopen the thread before choosing.'); };
  await h.pick(2);
  h.press(); await h.flush(); h.audio(); h.release();
  await h.flush(); await h.flush();
  await h.tap(); await h.flush();
  assert.equal(attempts, 1);
  assert.ok(h.upgrades.some(u => u.content.includes('Question changed')));
  assert.equal(h.sends.length, 0);
});

test('spoken option matching never infers a choice from a sentence containing a number', () => {
  assert.equal(textExports.choiceNumber('Option four.'), '4');
  assert.equal(textExports.choiceNumber('2'), '2');
  assert.equal(textExports.choiceNumber('I have one more question'), null);
  assert.equal(textExports.choiceNumber('not one'), null);
});


const workspaceThreads = [
  { handle: 'p', title: 'Archive session', agent: 'claude', state: 'idle', workspaceId: 'port', workspaceName: 'porttracker', workspaceLabel: 'porttracker' },
  { handle: 'g', title: 'Glasses session', agent: 'codex', state: 'busy', workspaceId: 'glass', workspaceName: 'orca-glass', workspaceLabel: 'orca-glass' },
  { handle: 's', title: 'Settings session', agent: 'claude', state: 'idle', workspaceId: 'pc', workspaceName: 'pc-settings', workspaceLabel: 'pc-settings' },
];

test('workspace multi-select stays open, persists, combines with agent filter and shows workspace/agent labels', async () => {
  const h = await harness();
  const saved = [];
  h.api.threads = async () => workspaceThreads;
  h.bridge.setLocalStorage = async (key, value) => { saved.push([key, value]); };
  await h.menu(1001);
  assert.match(menuItems(h)[0], /Filter by Agent/);
  assert.match(menuItems(h)[1], /Filter by Workspace/);
  const right = h.pages.at(-1).textObject.find(c => c.containerName === 'menu-right').content;
  assert.match(right, /\[porttracker\/Claude\]/);
  assert.match(right, /\[orca-glass\/Codex\]/);
  await h.pick(1);
  assert.deepEqual([...menuItems(h)], ['Done', '[x] All workspaces', '[ ] orca-glass', '[ ] pc-settings', '[ ] porttracker']);
  await h.pick(2);
  assert.equal(menuItems(h)[2], '[x] orca-glass');
  assert.match(h.pages.at(-1).textObject.find(c => c.containerName === 'body').content.split('\n')[2], /^>/);
  await h.pick(4);
  assert.equal(menuItems(h)[4], '[x] porttracker');
  assert.deepEqual(JSON.parse(saved.at(-1)[1]), ['glass', 'port']);
  await h.pick(0);
  assert.equal(menuItems(h).length, 4);
  assert.ok(menuItems(h).some(s => s.includes('Archive session')));
  assert.ok(!menuItems(h).some(s => s.includes('Settings session')));
  await h.pick(0); await h.pick(3);
  assert.equal(menuItems(h).length, 3);
  assert.ok(menuItems(h)[2].includes('Glasses session'));
  await h.pick(1); await h.pick(2); await h.pick(0);
  assert.equal(menuItems(h).length, 2);
  await h.pick(1); await h.pick(1); await h.pick(0);
  assert.equal(menuItems(h).length, 3);
  assert.deepEqual(saved.at(-1), ['view-workspaces', 'all']);
  assert.equal(h.sends.length + h.choices.length, 0);
});

test('restored workspace IDs survive missing sessions; empty and malformed preferences are distinct', async () => {
  const h = await harness(2, false, 'tap', '', 0, false, '["port"]');
  assert.equal(menuItems(h).length, 2);
  h.api.threads = async () => workspaceThreads;
  await h.menu(1001);
  assert.equal(menuItems(h).length, 3);
  assert.match(menuItems(h)[2], /Archive session/);
  const empty = await harness(2, false, 'tap', '', 0, false, '[]');
  assert.equal(menuItems(empty).length, 2);
  assert.match(empty.pages.at(-1).textObject.find(c => c.containerName === 'menu-right').content, /\[None\]/);
  const corrupt = await harness(2, false, 'tap', '', 0, false, '{bad');
  assert.equal(menuItems(corrupt).length, 4);
});

test('workspace picker pages reach every entry and saved unavailable workspaces can be cleared', async () => {
  const h = await harness(0, false, 'tap', '', 0, false, '["missing"]');
  h.api.workspaces = async () => Array.from({ length: 15 }, (_, i) => ({ id: `w${i}`, name: `Workspace ${String(i).padStart(2, '0')}` }));
  await h.pick(1);
  const seen = new Set();
  let unavailable = false;
  for (let page = 0; page < 5; page++) {
    const items = menuItems(h);
    unavailable ||= items.some(s => s.includes('unavailable'));
    items.filter(s => s.includes('Workspace ')).forEach(s => seen.add(s));
    assert.ok(items.length <= 10);
    assert.ok(!items.some(s => /^(Next|Previous) page$/.test(s)));
    if (seen.size === 15 && unavailable) break;
    for (let row = 0; row < items.length; row++) await h.scroll('down');
  }
  assert.equal(seen.size, 15);
  assert.ok(unavailable, 'saved missing workspace is listed so it can be cleared');
  await h.back();
  assert.equal(menuItems(h).length, 2);
});


test('workspaces with the same project name are filtered by exact Orca ID', async () => {
  const h = await harness();
  h.api.threads = async () => [
    { ...workspaceThreads[0], workspaceId: 'main-id', workspaceLabel: 'porttracker' },
    { ...workspaceThreads[0], handle: 'child', title: 'Child session', workspaceId: 'child-id', workspaceLabel: 'porttracker / experiment' },
  ];
  await h.menu(1001); await h.pick(1);
  const child = menuItems(h).findIndex(s => s.includes('experiment'));
  await h.pick(child); await h.pick(0);
  assert.equal(menuItems(h).length, 3);
  assert.match(menuItems(h)[2], /Child session/);
});


test('session edge swipes change pages in both directions and clamp at the outer ends', async () => {
  const h = await harness(15);
  assert.equal(menuItems(h).length, 9);
  for (let i = 0; i < 10; i++) await h.scroll('down');
  assert.match(menuItems(h)[2], /Session 7/);
  assert.match(h.pages.at(-1).textObject.find(c => c.containerName === 'menu-cursor').content.split('\n')[1], /^>/);
  await h.scroll('up');
  assert.match(h.upgrades.at(-1).content.split('\n')[0], /^>/);
  await h.scroll('up');
  assert.match(menuItems(h)[2], /Session 0/);
  assert.match(h.pages.at(-1).textObject.find(c => c.containerName === 'menu-cursor').content.split('\n')[9], /^>/);
  for (let i = 0; i < 9; i++) await h.scroll('up');
  const count = h.pages.length;
  await h.scroll('up');
  assert.equal(h.pages.length, count);
  for (let i = 0; i < 19; i++) await h.scroll('down');
  assert.equal(menuItems(h).length, 3);
  assert.match(menuItems(h)[2], /Session 14/);
  await h.scroll('down'); await h.scroll('down');
  const finalCount = h.pages.length;
  await h.scroll('down');
  assert.equal(h.pages.length, finalCount);
});

test('workspace edge swipes retain checks and reverse to the last row of the previous page', async () => {
  const h = await harness(0);
  h.api.workspaces = async () => Array.from({ length: 10 }, (_, i) => ({ id: `w${i}`, name: `Workspace ${String(i).padStart(2, '0')}` }));
  await h.pick(1);
  // No activity times: no headings; Done, All and eight workspaces fill ten rows.
  assert.equal(menuItems(h).length, 10);
  for (let i = 0; i < 9; i++) await h.scroll('down');
  await h.tap();
  assert.equal(menuItems(h)[9], '[x] Workspace 07');
  await h.scroll('down');
  assert.equal(menuItems(h)[2], '[ ] Workspace 08');
  assert.match(h.pages.at(-1).textObject.find(c => c.containerName === 'body').content, /^> Done/);
  await h.scroll('up');
  assert.equal(menuItems(h)[9], '[x] Workspace 07');
  assert.match(h.pages.at(-1).textObject.find(c => c.containerName === 'body').content.split('\n')[9], /^>/);
  await h.scroll('down');
  await h.pick(2);
  assert.equal(menuItems(h)[2], '[x] Workspace 08');
  await h.pick(0);
  assert.match(h.pages.at(-1).textObject.find(c => c.containerName === 'menu-right').content, /2 selected/);
});

test('rapid edge swipes and clicks cannot skip pages or activate a row during a page fetch', async () => {
  const h = await harness(20);
  for (let i = 0; i < 8; i++) await h.scroll('down');
  let finish, calls = 0;
  h.api.threads = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
  await h.scroll('down'); await h.scroll('down'); await h.tap();
  assert.equal(calls, 1);
  finish(h.threads); await h.flush();
  assert.match(menuItems(h)[2], /Session 7/);
  assert.equal(h.sends.length + h.choices.length, 0);
});

test('an in-flight page fetch cannot reopen the glasses after system exit', async () => {
  const h = await harness(15);
  for (let i = 0; i < 9; i++) await h.scroll('down');
  let finish;
  h.api.threads = () => new Promise(resolve => { finish = resolve; });
  await h.scroll('down');
  const count = h.pages.length;
  await h.system(7);
  finish(h.threads); await h.flush();
  assert.equal(h.pages.length, count);
  assert.equal(h.timers.size, 0);
});

test('Usage top toggle cycles and persists three reset modes without re-fetching or rebuilding the page', async () => {
  const h = await harness();
  let requests = 0;
  const saved = [];
  h.bridge.setLocalStorage = async (key, value) => { saved.push([key, value]); };
  h.api.usage = async () => { requests++; return { codex: { provider: 'codex', status: 'ok', weekly: {
    usedPercent: 42, resetsAt: Date.now() + (2 * 1440 + 5 * 60 + 12) * 60000,
    resetDescription: 'Original label', computerResetDescription: 'Thu 1:12 AM',
  } } }; };
  await h.menu(1003);
  const page = h.pages.at(-1), count = h.pages.length;
  assert.equal(page.containerTotalNum, 3);
  const toggle = page.textObject.find(c => c.containerName === 'usage-reset');
  assert.match(toggle.content, /Computer time/);
  assert.ok(page.textObject.find(c => c.containerName === 'body').yPosition >= toggle.yPosition + toggle.height);
  await h.tap();
  assert.match(h.upgrades.findLast(u => u.containerName === 'usage-reset').content, /Phone time/);
  await h.tap();
  assert.match(h.upgrades.findLast(u => u.containerName === 'usage-reset').content, /Absolute time/);
  assert.match(h.upgrades.findLast(u => u.containerName === 'body').content, /2d5h12m/);
  await h.tap();
  assert.match(h.upgrades.findLast(u => u.containerName === 'body').content, /Thu 1:12 AM/);
  assert.deepEqual(saved, [['usage-reset-mode', 'phone'], ['usage-reset-mode', 'absolute'], ['usage-reset-mode', 'computer']]);
  assert.equal(requests, 1);
  assert.equal(h.pages.length, count);
  for (const u of h.upgrades.filter(u => u.containerName === 'usage-reset')) assert.ok(!('xPosition' in u || 'width' in u));
  await h.back();
  assert.match(menuItems(h)[0], /Filter by Agent/);
});

test('Usage restores its saved reset mode', async () => {
  const h = await harness(2, false, 'tap', '', 0, false, '', 'absolute');
  h.api.usage = async () => ({ cursor: { provider: 'cursor', status: 'ok', monthly: { usedPercent: 2, resetsAt: Date.now() - 1000, resetDescription: 'Old label' } } });
  await h.menu(1003);
  assert.match(h.pages.at(-1).textObject.find(c => c.containerName === 'usage-reset').content, /Absolute time/);
  assert.match(h.pages.at(-1).textObject.find(c => c.containerName === 'body').content, /Monthly 2% \(0m\)/);
});

test('native text widths use measured firmware advances so rows reach the right edge', () => {
  // Values measured in the native simulator; Arial 21px would report ~10-15% more.
  assert.equal(textExports.glassTextWidth('Page 2 of 2'), 98);
  assert.equal(textExports.glassTextWidth('[Tap & hold to input]'), 177);
  assert.equal(textExports.glassTextWidth('…', () => 9), 9);
  const prose = 'The reader now wraps every row with the measured firmware glyph widths instead of the wider browser Arial estimate, so each row runs close to the frame.';
  const rows = readerPageText(prose, t => textExports.glassTextWidth(t), 552)[0].split('\n');
  assert.ok(rows.every(row => textExports.glassTextWidth(row) <= 552));
  assert.ok(textExports.glassTextWidth(rows[0]) > 500, 'first row should fill most of the 560px body');
  // Right-aligned labels keep 3px slack: a 278px line wrapped in a 280px container.
  const padded = listExports.nativeRight('Page 2 of 2', 280);
  assert.ok(textExports.glassTextWidth(padded) <= 277 && textExports.glassTextWidth(padded) > 270);
});

test('session titles extend to their own label and keep the handle suffix', () => {
  const title = listExports.menuTitle('Campaign A50 exception loads and remaining scope review · a1b2c3', 300);
  assert.ok(title.endsWith('… · a1b2c3'), title);
  assert.equal(listExports.menuTitle('Short title · a1b2c3', 300), 'Short title · a1b2c3');
});

test('swiping down on the last page resumes live updates and refreshes at once', async () => {
  const h = await harness();
  const lines = n => Array.from({ length: n }, (_, i) => `Line ${i}`).join('\n');
  h.api.thread = async () => ({ text: lines(12) });
  await h.pick(2);
  const body = () => h.upgrades.findLast(u => u.containerName === 'body')?.content;
  await h.scroll('up');                       // Browsing freezes the snapshot.
  await h.scroll('down');                     // Back on the last page: still frozen.
  assert.match(statusHint(h), /Pg2\/2$/);
  h.api.thread = async () => ({ text: lines(20) });
  await [...h.timers.values()][0]();
  assert.equal(body(), 'Line 9\nLine 10\nLine 11');   // Frozen poll ignored the new output.
  const rebuilds = h.pages.length;
  await h.scroll('down');                     // Swipe past the last page: refresh.
  await h.flush();
  assert.ok(h.upgrades.some(u => u.containerName === 'hint' && /Refreshing…$/.test(u.content.trim())));
  assert.equal(body(), 'Line 18\nLine 19');
  assert.match(statusHint(h), /Pg3\/3$/);
  assert.equal(h.pages.length, rebuilds);
  assert.equal(h.sends.length, 0);
  h.api.thread = async () => ({ text: lines(21) });
  await [...h.timers.values()].at(-1)();      // Live polling continues afterwards.
  assert.equal(body(), 'Line 18\nLine 19\nLine 20');
});

test('opening a session shows the page that starts the latest response', async () => {
  const h = await harness();
  const earlier = Array.from({ length: 9 }, (_, i) => `  earlier line ${i}`).join('\n');
  const latest = Array.from({ length: 9 }, (_, i) => `  latest line ${i}`).join('\n');
  const text = `/ first question\n> First answer\n${earlier}\n/ second question\n> Progress note before the answer.\n> Latest answer starts here\n${latest}`;
  h.api.history = async () => ({ text, source: 'claude-transcript' });
  await h.pick(2);
  const open = h.pages.at(-1);
  assert.match(open.textObject[1].content, /^> Latest answer starts here\n/);
  const hint = open.textObject.find(c => c.containerName === 'hint').content.trim();
  const [, page, total] = hint.match(/Pg(\d+)\/(\d+)$/);
  assert.ok(Number(page) < Number(total), 'long response opens before the last page');
  // Earlier pages remain reachable and every character is kept.
  assert.equal(textExports.latestResponseStart(text), text.indexOf('> Latest'));
  assert.equal(textExports.latestResponseStart('/ only a question'), -1);
  assert.equal(textExports.latestResponseStart('plain terminal text'), -1);
});

test('status row shows the model and shrinks the hint to fit one row', async () => {
  const h = await harness();
  h.api.history = async () => ({ text: '/ question\n> answer', source: 'claude-transcript', model: 'Opus5.5' });
  h.api.activity = async () => ({ state: 'waiting' });
  await h.pick(2);
  const page = h.pages.at(-1);
  assert.equal(page.textObject.find(c => c.containerName === 'voice').content, 'Opus5.5 /Waiting');
  // The spinner image sits right after the model name.
  assert.equal(page.imageObject[0].xPosition, 16 + listExports.glassWidth('Opus5.5 '));
  assert.equal(page.textObject.find(c => c.containerName === 'hint').content.trim(), '[Tap&Hold for Input] Pg1/1');
  // A model switch rebuilds the page so the spinner image moves with the name.
  h.api.history = async () => ({ text: '/ question\n> answer', source: 'claude-transcript', model: 'Sonnet5.5' });
  await [...h.timers.values()][0]();
  assert.equal(h.pages.at(-1).textObject.find(c => c.containerName === 'voice').content, 'Sonnet5.5 /Waiting');
  assert.equal(h.pages.at(-1).imageObject[0].xPosition, 16 + listExports.glassWidth('Sonnet5.5 '));
  // The widest working state cannot fit the full hint next to a long model.
  const w = t => textExports.glassTextWidth(t, () => 12);
  h.api.history = async () => ({ text: '/ question\n> answer', source: 'codex-transcript', model: 'GPT-6-Astra med' });
  h.api.activity = async () => ({ state: 'working', elapsedSeconds: 812 });
  await [...h.timers.values()][0]();
  // The model change rebuilt the page; its hint is the current one.
  const right = h.pages.at(-1).textObject.find(c => c.containerName === 'hint').content.trim();
  assert.match(right, /^13m32s (?:\[T&H\] )?Pg1\/1$/);
  const left = Math.max(...statusExports.WORKING_LABELS.map(word => w(`GPT-6-Astra med     ${word}...`)));
  assert.ok(left + 10 + w(right) <= 538, `${left} + ${w(right)}`);
});

test('four-digit page counters shrink the hint instead of wrapping the status row', async () => {
  const h = await harness();
  h.api.history = async () => ({ text: Array.from({ length: 13200 }, (_, i) => `> Row ${i}`).join('\n'), source: 'codex-transcript', model: 'GPT-6-Astra med' });
  h.api.activity = async () => ({ state: 'working', elapsedSeconds: 812 });
  await h.pick(2);
  const right = h.pages.at(-1).textObject.find(c => c.containerName === 'hint').content.trim();
  assert.match(right, /^13m32s (?:\[T&H\] )?Pg\d{4}\/\d{4}$/);
  const w = t => textExports.glassTextWidth(t, () => 12);
  const left = Math.max(...statusExports.WORKING_LABELS.map(word => w(`GPT-6-Astra med     ${word}...`)));
  assert.ok(left + 10 + w(right) <= 538 && w(right) <= 274, `${left} + ${w(right)}`);
});

test('workspace picker has no title, lists four recent workspaces first and the cursor skips headings', async () => {
  const h = await harness(0);
  const names = ['zeta', 'ai-family-office', 'porttracker', 'ai-stock-picker-and-alerts-app', 'orca-glass', 'pc-settings', 'bamboa', 'desk', 'market-sessions', 'union-mq'];
  // Activity order (newest first): porttracker, orca-glass, pc-settings, zeta, then older.
  const times = { porttracker: 900, 'orca-glass': 800, 'pc-settings': 700, zeta: 600, desk: 100 };
  h.api.workspaces = async () => names.map(name => ({ id: name, name, lastActivityAt: times[name] }));
  await h.pick(1);
  const page = h.pages.at(-1);
  assert.equal(page.textObject.find(c => c.containerName === 'head').content, ' ');
  const body = page.textObject.find(c => c.containerName === 'body');
  assert.equal(body.yPosition, 4);
  assert.ok(body.height >= 270);
  assert.equal(JSON.stringify([...menuItems(h)]), JSON.stringify(['Done', '[x] All workspaces', 'Recent workspaces',
    '[ ] porttracker', '[ ] orca-glass', '[ ] pc-settings', '[ ] zeta', 'Other workspaces',
    '[ ] ai-family-office', '[ ] ai-stock-picker-and-alerts-app']));
  const rows = body.content.split('\n');
  assert.equal(rows[2], 'Recent workspaces');                 // Headings carry no cursor column.
  await h.scroll('down'); await h.scroll('down');             // All -> skips heading -> porttracker.
  assert.match(h.upgrades.at(-1).content.split('\n')[3], /^> \[ \] porttracker/);
  for (let i = 0; i < 4; i++) await h.scroll('down');         // zeta -> skips heading -> ai-family-office.
  assert.match(h.upgrades.at(-1).content.split('\n')[8], /^> \[ \] ai-family-office/);
  await h.scroll('down'); await h.scroll('down');             // Past the last row: next page.
  assert.equal(JSON.stringify([...menuItems(h)]), JSON.stringify(['Done', '[x] All workspaces', '[ ] bamboa', '[ ] desk', '[ ] market-sessions', '[ ] union-mq']));
  await h.scroll('up');                                       // Back: previous page, last row.
  assert.match(h.pages.at(-1).textObject.find(c => c.containerName === 'body').content.split('\n')[9], /^> \[ \] ai-stock/);
});

test('Hermes and Orca keep separate workspace pages, selections and session lists', async () => {
  const h = await harness(0, false, 'tap', 'hermes', 0, false, '["porttracker-id"]');
  const saved = [];
  h.bridge.setLocalStorage = async (key, value) => { saved.push([key, value]); };
  h.api.threads = async () => [
    { handle: 'codex-1', title: 'Codex work', agent: 'codex', state: 'idle', workspaceId: 'orca-glass-id', workspaceName: 'orca-glass', workspaceLabel: 'orca-glass', lastOutputAt: 50 },
    { handle: 'claude-1', title: 'Claude port', agent: 'claude', state: 'idle', workspaceId: 'porttracker-id', workspaceName: 'porttracker', workspaceLabel: 'porttracker', lastOutputAt: 45 },
    { handle: 'hermes:1', title: 'Hermes chat', agent: 'hermes', state: 'idle', workspaceId: 'bot-gm', workspaceName: 'Grand Master Bot', workspaceLabel: 'Grand Master Bot', hermesGroup: 'bot', lastOutputAt: 40 },
  ];
  h.api.workspaces = async () => [...['orca-glass', 'porttracker', 'zeta'].map((name, i) => ({ id: `${name}-id`, name, lastActivityAt: 100 - i })),
    { id: 'bot-gm', name: 'Grand Master Bot', hermes: 'bot' }];
  await h.menu(1001);
  // Hermes Agent: only Hermes sessions; the saved Orca selection does not apply.
  let list = [...menuItems(h)];
  assert.ok(list.some(s => s.includes('Hermes chat')) && !list.some(s => /Codex work|Claude port/.test(s)), list.join(' | '));
  await h.pick(1);
  const hermesPage = [...menuItems(h)];
  assert.ok(hermesPage.includes('[ ] Grand Master Bot'));
  assert.ok(!hermesPage.some(s => /orca-glass|porttracker|zeta/.test(s)), hermesPage.join(' | '));
  await h.pick(hermesPage.indexOf('[ ] Grand Master Bot'));
  assert.equal(saved.at(-1)[0], 'view-hermes-workspaces');
  await h.pick(0);
  // Switch to All Orca Sessions: Orca workspace page with its own saved selection.
  await h.pick(0); await h.pick(1);
  list = [...menuItems(h)];
  assert.ok(list.some(s => s.includes('Claude port')) && !list.some(s => /Hermes chat|Codex work/.test(s)), list.join(' | '));
  await h.pick(1);
  const orcaPage = [...menuItems(h)];
  assert.ok(orcaPage.includes('[x] porttracker'));
  assert.ok(!orcaPage.some(s => s.includes('Grand Master Bot')), orcaPage.join(' | '));
});

test('Hermes picker shows Bots, Sessions and Scheduled jobs instead of Orca workspaces', async () => {
  const h = await harness(0, false, 'tap', 'hermes');
  h.api.threads = async () => [
    { handle: 'codex-1', title: 'Codex work', agent: 'codex', state: 'idle', workspaceId: 'orca-glass-id', workspaceLabel: 'orca-glass', lastOutputAt: 99 },
    { handle: 'hermes:1', title: 'Chat', agent: 'hermes', state: 'idle', workspaceId: 'bot-gm', workspaceName: 'Grand Master Bot', workspaceLabel: 'Grand Master Bot', hermesGroup: 'bot', lastOutputAt: 50 },
    { handle: 'hermes:2', title: 'Plan', agent: 'hermes', state: 'idle', workspaceId: 'session-plan', workspaceName: 'Grand Master Bot', workspaceLabel: 'Complete porttracker', hermesGroup: 'session', lastOutputAt: 40 },
    { handle: 'hermes:3', title: 'Run', agent: 'hermes', state: 'idle', workspaceId: 'job-amc', workspaceName: 'Schedule Bot', workspaceLabel: 'AMC sign-up', hermesGroup: 'job', lastOutputAt: 60 },
  ];
  h.api.workspaces = async () => [
    { id: 'orca-glass-id', name: 'orca-glass', lastActivityAt: 100 },
    { id: 'bot-gm', name: 'Grand Master Bot', hermes: 'bot' },
    { id: 'bot-writer', name: 'Writer Bot', hermes: 'bot' },
    { id: 'job-amc', name: 'AMC sign-up', hermes: 'job' },
    { id: 'job-fehd', name: 'FEHD list', hermes: 'job' },
  ];
  await h.menu(1001); await h.pick(1);
  assert.equal(JSON.stringify([...menuItems(h)]), JSON.stringify(['Done', '[x] All workspaces',
    'Bots', '[ ] Grand Master Bot', '[ ] Writer Bot',
    'Sessions', '[ ] Complete porttracker',
    'Scheduled jobs', '[ ] AMC sign-up', '[ ] FEHD list']));
  // Selecting a bot filters the Hermes session list to that bot's chats.
  await h.pick(3); await h.pick(0);
  const list = [...menuItems(h)];
  assert.ok(list.some(s => s.includes('Chat')) && !list.some(s => s.includes('Plan') || s.includes('Run')), list.join(' | '));
});

test('phone filters and glasses share one saved selection and redraw each other', async () => {
  const h = await harness();
  h.api.threads = async () => [
    { handle: 'codex', title: 'Codex chat', agent: 'codex', workspaceId: 'w1', workspaceName: 'alpha' },
    { handle: 'claude', title: 'Claude chat', agent: 'claude', workspaceId: 'w2', workspaceName: 'beta' },
    { handle: 'hermes:x', title: 'Bot chat', agent: 'hermes', workspaceId: 'hermes-bot:1', workspaceName: 'Bot', workspaceLabel: 'Bot', hermesGroup: 'bot' },
  ];
  const saved = [];
  h.bridge.setLocalStorage = async (key, value) => { saved.push([key, value]); };
  // Demo start reports the connection to the phone page.
  assert.deepEqual(h.phoneCalls[0], ['connection', 'demo']);
  const phone = h.phone();
  const f0 = phone.filters();
  assert.deepEqual([f0.provider, f0.orca, f0.hermes], ['all', null, null]);
  // Phone picks an Orca workspace while the glasses show the session list: the list redraws.
  const before = h.pages.length;
  await phone.setWorkspaces(false, new Set(['w2']));
  await h.flush();
  assert.deepEqual(saved.at(-1), ['view-workspaces', '["w2"]']);
  assert.ok(h.pages.length > before);
  assert.match(menuItems(h).join(' | '), /Claude chat/);
  assert.doesNotMatch(menuItems(h).join(' | '), /Codex chat/);
  // Phone switches to Hermes Agent: Hermes keeps its own, separate selection.
  await phone.setProvider('hermes');
  await h.flush();
  assert.deepEqual(saved.at(-1), ['view-provider', 'hermes']);
  assert.match(menuItems(h).join(' | '), /Bot chat/);
  const f1 = phone.filters();
  assert.deepEqual([f1.provider, [...f1.orca], f1.hermes], ['hermes', ['w2'], null]);
  // A glasses change redraws the phone page.
  const renders = h.phoneCalls.filter(c => c[0] === 'render').length;
  await h.pick(0);
  await h.pick(1); // All Orca Sessions
  assert.ok(h.phoneCalls.filter(c => c[0] === 'render').length > renders);
  assert.equal(phone.filters().provider, 'all');
});

test('small text draws the whole screen, status row included, as four tiles and switches back', async () => {
  const h = await harness();
  const nl = String.fromCharCode(10);
  const output = Array.from({ length: 50 }, (_, i) => `Line ${i}`).join(nl);
  h.api.thread = async () => ({ text: output });
  const saved = [];
  h.bridge.setLocalStorage = async (key, value) => { saved.push([key, value]); };
  await h.pick(2);
  // Fonts and the comparison fit in one list. Terminus 6x12 is the third small face.
  await h.menu(1101);
  assert.deepEqual(menuItems(h), ['Native text ✓', 'Departure 7x14', 'Misc Fixed 6x13', 'Terminus 6x12',
    'GohuFont 6x11', 'Scientifica 5x11', 'Compare fonts']);
  assert.deepEqual(Object.keys(glyphExports), ['DEPARTURE_MONO', 'TERMINUS', 'GOHU', 'SCIENTIFICA', 'FIXED', 'SHINONOME_K12']);
  const fontCursor = () => h.pages.at(-1).textObject.find(c => c.containerName === 'body').content.split('\n').findIndex(row => row.startsWith('>'));
  await h.scroll('up');
  assert.equal(fontCursor(), 6); // wraps to the last row, Compare fonts
  await h.scroll('down');
  assert.equal(fontCursor(), 0);
  await h.pick(3);
  const page = h.pages.at(-1);
  assert.deepEqual(saved.slice(-2), [['reader-text', 'terminus'], ['reader-font', 'terminus']]);
  assert.equal(page.containerTotalNum, 5);
  assert.equal(JSON.stringify(page.textObject.map(t => [t.containerID, t.width, t.height, t.isEventCapture, t.content])), JSON.stringify([[1, 576, 288, 1, ' ']]));
  assert.equal(JSON.stringify(page.imageObject.map(i => [i.containerID, i.xPosition, i.yPosition, i.width, i.height])),
    JSON.stringify([[2, 0, 0, 288, 144], [3, 288, 0, 288, 144], [4, 0, 144, 288, 144], [5, 288, 144, 288, 144]]));
  assert.equal(JSON.stringify(page.menuObject.menuItems.map(i => i.itemName)),
    JSON.stringify(['Font: Terminus 6x12', 'App Brightness: 15']));
  // Every possible label fits the menu without truncation (about 210px in the firmware font).
  for (const f of fineExports.FINE_FONTS) assert.ok(listExports.glassWidth(`Font: ${fineExports.fineLabel(f)}`) <= 210, fineExports.fineLabel(f));
  const layout = fineExports.fineLayout('terminus');
  assert.deepEqual([layout.columns, layout.rows], [95, 22]);
  // Every font on its own whole-pixel grid, filling the 574px inside the frame.
  assert.equal(JSON.stringify(Object.fromEntries(fineExports.FINE_FONTS.map(f => { const l = fineExports.fineLayout(f); return [f, [l.cell, l.line, l.columns, l.rows]]; }))),
    JSON.stringify({ scientifica: [5, 11, 114, 24], gohu: [6, 11, 95, 24], terminus: [6, 12, 95, 22],
      fixed: [6, 13, 95, 20], departure: [7, 14, 82, 18] }));
  // A full row is exactly `columns` cells, and one more cell wraps. The gap
  // inside the frame is shorter than one cell, so Departure 7px (82) and the
  // narrower fonts both run to the right edge.
  const sentence = 'The quick brown fox jumps over the lazy dog. '.repeat(8);
  for (const f of fineExports.FINE_FONTS) {
    const l = fineExports.fineLayout(f);
    assert.ok(l.textX >= 1 && l.textX + l.textWidth <= 575, f);
    assert.ok(574 - l.textWidth < l.cell, f);
    const measure = fineExports.fineMeasure(f);
    const full = 'M'.repeat(l.columns);
    assert.equal(readerPageText(full, measure, l.textWidth, l.rows, Infinity)[0], full);
    assert.deepEqual(readerPageText(full + 'N', measure, l.textWidth, l.rows, Infinity)[0].split('\n'), [full, 'N']);
    const row = readerPageText(sentence, measure, l.textWidth, l.rows, Infinity)[0].split('\n')[0];
    assert.ok(l.columns - fineExports.fineCells(row) < 6, `${f} left ${l.columns - fineExports.fineCells(row)} cells`);
  }
  // GohuFont 6x11 still draws the original cell and leaves the next cell empty.
  const gohu = fineExports.fineLayout('gohu');
  const tile = renderFineText('M', 'gohu', { left: '', right: '' })[0];
  let ink = 0;
  for (let y = 4; y < 4 + gohu.line; y++) {
    for (let x = 0; x < gohu.cell; x++) if (tile[y * 288 + gohu.textX + x] > 0) ink++;
    assert.equal(tile[y * 288 + gohu.textX + gohu.cell], 0);
  }
  assert.ok(ink > 8);
  // Picking a font from the list switches to it. Leaving the list keeps the current face.
  await h.menu(1101);
  await h.pick(1);
  assert.deepEqual(saved.slice(-2), [['reader-text', 'departure'], ['reader-font', 'departure']]);
  assert.equal(h.pages.at(-1).menuObject.menuItems[0].itemName, 'Font: Departure 7x14');
  const pagesBefore = h.pages.length;
  await h.menu(1101);
  await h.back();
  assert.equal(h.pages.length, pagesBefore + 2);
  assert.equal(h.pages.at(-1).menuObject.menuItems[0].itemName, 'Font: Departure 7x14');
  await h.menu(1101);
  await h.pick(3);
  assert.deepEqual(saved.at(-1), ['reader-font', 'terminus']);
  // 50 lines at 22 rows: three pages, opening on the newest. The tiles sent are
  // exactly the rendered screen with the status row drawn in.
  const sent = () => h.images.filter(i => /^fine-/.test(i.containerName));
  const expected = (from, pageNo) => renderFineText(Array.from({ length: Math.min(22, 50 - from) }, (_, i) => `Line ${from + i}`).join(nl),
    'terminus', { left: '/Status unknown', right: `[Tap&Hold for Input] Pg${pageNo}/3` });
  // A rebuild re-sends all four tiles for the Terminus page.
  assert.equal(JSON.stringify(sent().slice(-4).map(i => i.containerName)), JSON.stringify(['fine-0', 'fine-1', 'fine-2', 'fine-3']));
  assert.equal(JSON.stringify(sent().slice(-4).map(i => i.imageData)), JSON.stringify(expected(44, 3)));
  // A page turn re-sends only tiles that changed and keeps native text untouched.
  const before = sent().length;
  await h.scroll('up'); await h.flush();
  const turned = sent().slice(before);
  const want = expected(22, 2);
  assert.ok(turned.length >= 1 && turned.length <= 4);
  for (const tile of turned) assert.equal(JSON.stringify(tile.imageData), JSON.stringify(want[Number(tile.containerName.slice(5))]));
  assert.ok(!h.upgrades.some(u => ['body', 'voice', 'hint'].includes(u.containerName)));
  // The display test replaces the tiles; the next swipe restores the page.
  await h.menu(1101); await h.pick(6); await h.flush();
  assert.equal(JSON.stringify(sent().slice(-4).map(i => i.imageData)), JSON.stringify(fineExports.renderFontComparison()));
  await h.scroll('down'); await h.flush();
  const restored = new Map(sent().slice(-4).map(i => [i.containerName, i.imageData]));
  for (const [name, data] of restored) assert.equal(JSON.stringify(data), JSON.stringify(want[Number(name.slice(5))]));
  // App Brightness is steps 15 down to 1, ten rows a page, with no blank row and no 0.
  await h.menu(1107);
  const bright = h.pages.at(-1).textObject.find(c => c.containerName === 'body');
  assert.equal(bright.yPosition, 4);
  assert.equal(bright.height, 280);
  assert.deepEqual(menuItems(h), ['15 ✓', '14', '13', '12', '11', '10', '9', '8', '7', '6']);
  const brightCursor = () => h.pages.at(-1).textObject.find(c => c.containerName === 'body').content.split('\n').findIndex(row => row.startsWith('>'));
  await h.scroll('up');
  assert.deepEqual(menuItems(h), ['5', '4', '3', '2', '1']);
  assert.equal(brightCursor(), 4);
  await h.scroll('down');
  assert.equal(menuItems(h)[0], '15 ✓');
  assert.equal(brightCursor(), 0);
  for (let i = 0; i < 10; i++) await h.scroll('down');
  assert.deepEqual(menuItems(h), ['5', '4', '3', '2', '1']);
  await h.scroll('up');
  assert.equal(menuItems(h).at(-1), '6');
  const dimFrom = sent().length;
  await h.pick(7);
  assert.deepEqual(saved.at(-1), ['reader-ink', '8']);
  const dim = renderFineText(Array.from({ length: 22 }, (_, i) => `Line ${22 + i}`).join(nl), 'terminus', { left: '/Status unknown', right: '[Tap&Hold for Input] Pg2/3' }, 8);
  const dimmed = sent().slice(dimFrom);
  assert.equal(dimmed.length, 4);
  for (const tile of dimmed) assert.equal(JSON.stringify(tile.imageData), JSON.stringify(dim[Number(tile.containerName.slice(5))]));
  // Back to native text on the page holding the same first line, at the chosen ink.
  await h.menu(1101);
  await h.pick(0);
  assert.deepEqual(saved.at(-1), ['reader-text', 'native']);
  assert.equal(h.pages.at(-1).containerTotalNum, 7);
  const native = h.pages.at(-1);
  assert.equal(native.textObject.find(c => c.containerName === 'body').textColor, 3);
  assert.equal(native.textObject.find(c => c.containerName === 'frame').borderColor, 8);
  assert.equal(native.textObject.find(c => c.containerName === 'hint').textColor, 3);
});

const sentFineTiles = h => h.images.filter(image => image.containerName.startsWith('fine-')).slice(-4).map(image => image.imageData);
function tilePixel(tiles, x, y) {
  return tiles[Math.floor(y / 144) * 2 + Math.floor(x / 288)][(y % 144) * 288 + (x % 288)];
}

test('saved removed reader modes and the saved comparison font fall back to Terminus', async () => {
  for (const id of ['fixed9', 'gohu14', 'shinonome']) {
    const h = await moduleHarness({ storage: { 'reader-text': id, 'reader-font': id } });
    await h.pick(2);
    assert.equal(h.pages.at(-1).menuObject.menuItems[0].itemName, 'Font: Terminus 6x12');
  }
  const h = await moduleHarness({ storage: { 'reader-text': 'native', 'reader-font': 'gohu14' } });
  await h.pick(2);
  const native = container(h, 'body').content;
  await h.menu(1101);
  await h.pick(6);
  assert.equal(JSON.stringify(sentFineTiles(h)), JSON.stringify(fineExports.renderFontComparison()));
  await h.scroll('up');
  assert.equal(h.pages.at(-1).containerTotalNum, 7);
  assert.equal(container(h, 'body').content, native);
});

test('user turn background follows wrapped and indented rows across pages without affecting other pixels', async () => {
  const h = await moduleHarness({ storage: { 'reader-text': 'terminus' } });
  const { rows, columns, line, textX, textWidth, statusY, dividerY } = fineExports.fineLayout('terminus');
  const text = [
    ...Array(rows - 1).fill('Earlier output'),
    '/ ' + 'M'.repeat(columns - 2) + ' continued',
    '  Another line from the user',
    '> ' + 'A'.repeat(columns - 2) + ' reply continues',
  ].join('\n');
  h.api.thread = async () => ({ text });
  await h.pick(2);
  const tiles = sentFineTiles(h);
  const right = textX + textWidth - 1;
  const dot = (x, y) => (x + y) % 2 === 0 ? 17 : 0;
  for (let y = 4; y < 4 + line * 2; y++) assert.equal(tilePixel(tiles, right, y), dot(right, y));
  const secondPage = textExports.readerPages(text, fineExports.fineMeasure('terminus'), textWidth, rows, Infinity)[1];
  const plain = fineExports.renderFineScreen(secondPage, 'terminus',
    { left: '/Status unknown', right: '[Tap&Hold for Input] Pg2/2' }, 15, false);
  for (let y = 0; y < 288; y++) {
    for (let x = 0; x < 576; x++) {
      const old = tilePixel(plain, x, y);
      const inUserBand = y >= 4 && y < 4 + line * 2 && x >= textX && x <= right;
      assert.equal(tilePixel(tiles, x, y), inUserBand && old === 0 ? dot(x, y) : old, `pixel ${x},${y}`);
    }
  }
  assert.equal(tilePixel(tiles, right, dividerY), 255);
  assert.equal(tilePixel(tiles, 0, statusY), 255);
  // The first user line is the final row of the preceding page.
  const before = h.images.length;
  await h.scroll('up');
  const changed = new Map(h.images.slice(before).map(image => [image.containerName, image.imageData]));
  const earlier = tiles.map((tile, i) => changed.get(`fine-${i}`) ?? tile);
  const lastRow = 4 + (rows - 1) * line;
  assert.equal(tilePixel(earlier, right, lastRow) + tilePixel(earlier, right, lastRow + 1), 17);
  assert.equal(tilePixel(earlier, right, 4 + (rows - 2) * line), 0);
});

test('user turns always use the Dots 1/2 checker at Ink 1, and none is drawn at App Brightness 1', async () => {
  const { textX, textWidth } = fineExports.fineLayout('terminus');
  const right = textX + textWidth - 1;
  const text = '/ Check this.\n> Checked.';
  // A value saved by the removed Background picker no longer changes anything.
  const h = await moduleHarness({ storage: { 'reader-text': 'terminus', 'reader-turn-bg': '3' } });
  h.api.thread = async () => ({ text });
  await h.pick(2);
  const tiles = sentFineTiles(h);
  const dot = (x, y) => (x + y) % 2 === 0 ? 17 : 0;
  for (const [x, y] of [[right, 4], [right, 5], [right - 1, 4], [right - 1, 5]]) assert.equal(tilePixel(tiles, x, y), dot(x, y));
  await h.menu(1101);
  assert.equal(menuItems(h).some(item => /Background/.test(item)), false);
  const dim = await moduleHarness({ storage: { 'reader-text': 'terminus', 'reader-ink': '1' } });
  dim.api.thread = async () => ({ text });
  await dim.pick(2);
  for (const y of [4, 5]) assert.equal(tilePixel(sentFineTiles(dim), right, y), 0); // no step left below Ink 1 text
});

test('reader ink follows the panel steps 1 through 15', () => {
  assert.equal(fineExports.parseInk(''), 15);
  assert.equal(fineExports.parseInk('0'), 15);
  assert.equal(fineExports.parseInk('8'), 8);
  assert.equal(fineExports.parseInk('16'), 15);
  assert.equal(fineExports.inkByte(15), 255);
  assert.equal(fineExports.inkByte(8), 136);
  assert.equal(fineExports.inkByte(0), 0);
  assert.equal(fineExports.nativeTextColor(15), 4);
  assert.equal(fineExports.nativeTextColor(12), 4);
  assert.equal(fineExports.nativeTextColor(8), 3);
  assert.equal(fineExports.nativeTextColor(1), 1);
  assert.equal(fineExports.nativeTextColor(0), 0);
  const full = renderFineText('M', 'gohu', { left: '', right: '' }, 15)[0];
  const dim = renderFineText('M', 'gohu', { left: '', right: '' }, 8)[0];
  let ink = 0;
  for (let i = 0; i < full.length; i++) {
    if (full[i] === 0) assert.equal(dim[i], 0);
    else { assert.equal(full[i], 255); assert.equal(dim[i], 136); ink++; }
  }
  assert.ok(ink > 8);
});

test('tile modes sweep a scanner light where native text shows the Braille spinner', () => {
  const heads = Array.from({ length: 15 }, (_, f) => fineExports.scannerLevels(f).indexOf(255));
  // Sweeps 0..7 and back, one segment per frame.
  assert.equal(JSON.stringify(heads), JSON.stringify([0, 1, 2, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2, 1, 0]));
  // A fading tail follows the light: right-moving at frame 3, left-moving at frame 10.
  assert.equal(JSON.stringify(fineExports.scannerLevels(3)), JSON.stringify([64, 112, 176, 255, 0, 0, 0, 0]));
  assert.equal(JSON.stringify(fineExports.scannerLevels(10)), JSON.stringify([0, 0, 0, 0, 255, 176, 112, 64]));
  // Two frames differ only in the bottom-left tile, where the status row starts.
  const frame = n => renderFineText('Line', 'terminus', { model: 'Opus5.5', scanner: n, left: 'Thinking...', right: 'Pg1/1' });
  const a = frame(0), b = frame(1);
  assert.equal(JSON.stringify([0, 1, 2, 3].map(i => JSON.stringify(a[i]) === JSON.stringify(b[i]))), JSON.stringify([true, true, false, true]));
});

test('small-text modes pad Markdown tables so columns line up in monospace', () => {
  const nl = String.fromCharCode(10);
  const input = ['> Here:', '  | Mode | Cols | Chars/page |', '  |:--|--:|:-:|', '  | native | ~55 | ~500 |', '  | pixel | 93 | ~1860 |', '  Done.'].join(nl);
  assert.equal(fineExports.alignMarkdownTables(input), ['> Here:',
    '  | Mode   | Cols | Chars/page |',
    '  | ------ | ---- | ---------- |',
    '  | native |  ~55 |    ~500    |',
    '  | pixel  |   93 |   ~1860    |',
    '  Done.'].join(nl));
  // Pipe text without a rule row is not a table and stays as written.
  assert.equal(fineExports.alignMarkdownTables('> a | b |' + nl + '  | x |'), '> a | b |' + nl + '  | x |');
});

test('Filter by Agent pages past ten rows with visible more-below and more-above cues', async () => {
  const h = await harness();
  const agents = ['codex', 'claude', 'cursor', 'opencode2', 'pi', 'openclaude', 'gemini', 'aider', 'goose', 'amp'];
  h.api.threads = async () => agents.map((agent, i) => ({ handle: `t${i}`, title: agent, agent }));
  await h.pick(0);
  const rows = () => h.pages.at(-1).textObject.find(c => c.containerName === 'body').content.split(String.fromCharCode(10)).map(r => r.replace(/^[> ] /, '').trim());
  // Hermes + All + ten agents = twelve rows: nine on page one, then the cue.
  assert.equal(rows().length, 10);
  assert.deepEqual(rows().slice(0, 2), ['Hermes Agent', 'All Orca Sessions ✓']);
  assert.equal(rows().at(-1), 'v more below');
  // Swipe down past the last agent (the cue row is skipped): page two.
  for (let i = 0; i < 8; i++) await h.scroll('down');
  assert.equal(rows()[0], '^ more above');
  assert.ok(rows().some(r => /amp/i.test(r)));
  // Swipe up past the first agent: back to page one.
  await h.scroll('up'); await h.scroll('up'); await h.scroll('up');
  assert.equal(rows()[0], 'Hermes Agent');
});

test('wrapped rows hang under the text after the / and > markers', () => {
  const nl = String.fromCharCode(10);
  const mono = t => [...t].length * 6;
  const text = ['/ blah blah blah blah blah blah', '> blah blah blah blah blah blah', '  blah blah blah blah blah blah', 'plain blah blah blah blah blah'].join(nl);
  const rows = readerPageText(text, mono, 6 * 18, 20)[0].split(nl);
  assert.deepEqual([...rows], [
    '/ blah blah blah', '  blah blah blah',
    '> blah blah blah', '  blah blah blah',
    '  blah blah blah', '  blah blah blah',
    'plain blah blah', 'blah blah blah']);
  // Proportional native text: the indent is the run of spaces closest in width to '> '.
  const native = t => [...t].reduce((n, c) => n + (c === ' ' ? 5 : c === '>' ? 12 : 10), 0);
  const second = readerPageText('> ' + 'word '.repeat(20), native, 120, 20)[0].split(nl)[1];
  assert.match(second, /^ {3}\S/);
});

test('wrapped list items hang under the item text', () => {
  const nl = String.fromCharCode(10);
  const mono = t => [...t].length * 6;
  const rows = readerPageText(['  - blah blah blah blah blah', '> 12. blah blah blah blah blah'].join(nl), mono, 6 * 18, 20)[0].split(nl);
  assert.deepEqual([...rows], ['  - blah blah blah', '    blah blah', '> 12. blah blah', '      blah blah', '      blah']);
});

test('switching the phone language to Japanese redraws glasses labels and keeps the status row fitting', async () => {
  const h = await harness();
  const select = h.elements.get('lang');
  select.value = 'ja';
  await select.listeners.change();
  await h.flush();
  try {
    // Session list: contextual menu and filter rows are redrawn in Japanese.
    assert.deepEqual([...h.pages.at(-1).menuObject.menuItems].map(i => i.itemName), ['セッションを更新', '新規セッション', '使用量']);
    assert.match(menuItems(h)[0], /^エージェントで絞り込み/);
    // Reader: Japanese status word, hint and page counter share the one status row.
    await h.pick(2);
    const page = h.pages.at(-1);
    assert.equal(page.textObject.find(c => c.containerName === 'voice').content, '/状態不明');
    const hint = page.textObject.find(c => c.containerName === 'hint').content.trim();
    assert.match(hint, /^\[長押しで入力\] P1\/1$/);
    assert.ok(listExports.glassWidth(hint) <= 280 - 6);
    assert.equal(JSON.stringify(page.menuObject.menuItems.map(i => i.itemName)), JSON.stringify(['フォント: 標準フォント', 'アプリの明るさ: 15']));
    assert.equal(statusExports.readerStatus('waiting'), '/入力待ち');
    assert.match(statusExports.readerStatus('working', 0, 5000), /思考中\.$/);
    // The hint still shrinks step by step when the row is crowded.
    assert.equal(hintExports.statusRight(null, false, 'P7/8', t => new TextEncoder().encode(t).length <= 10), '[T&H] P7/8');
    assert.equal(hintExports.statusRight(null, true, 'P1/2'), '[クリックで選択] P1/2');
    assert.equal(usageResetExports.resetModeLabel('absolute'), '残り時間');
    for (const f of fineExports.FINE_FONTS) assert.ok(listExports.glassWidth(`フォント: ${fineExports.fineLabel(f)}`) <= 210, fineExports.fineLabel(f));
    for (const item of page.menuObject.menuItems) assert.ok(new TextEncoder().encode(item.itemName).length <= 32, item.itemName);
  } finally { select.value = 'en'; await select.listeners.change(); await h.flush(); }
  assert.equal(statusExports.readerStatus('waiting'), '/Waiting');
});

test('Japanese draws from the Shinonome wide table in every small font', () => {
  // あ (U+3042) and 漢 are in the 12x12 table: two cells, real pixels, no canvas fallback.
  for (const font of fineExports.FINE_FONTS) {
    const tiles = renderFineText('あ漢', font, { left: '', right: '' });
    const lit = tiles.reduce((n, tile) => n + tile.filter(v => v > 0).length, 0);
    const blank = renderFineText('', font, { left: '', right: '' }).reduce((n, tile) => n + tile.filter(v => v > 0).length, 0);
    assert.ok(lit - blank > 40, `${font}: ${lit - blank} glyph pixels`);
  }
  assert.equal(fineExports.fineCells('日本語abc'), 9);
});

test('Japanese wraps between characters but never starts a row with closing punctuation', () => {
  const nl = String.fromCharCode(10);
  const cells = t => [...t].reduce((n, c) => n + (c.charCodeAt(0) > 0x2e80 ? 2 : 1), 0) * 6;
  // 'UTC の実行日…': before, the whole Japanese run moved to the next row.
  const rows = readerPageText('> 明細の日付を UTC の実行日と比べているため、翌日扱いになりました。', cells, 6 * 24, 20)[0].split(nl);
  assert.ok(rows.length >= 2);
  assert.ok(rows.every(row => cells(row) <= 6 * 24), rows.join('|'));
  assert.ok(cells(rows[0]) >= 6 * 22, `first row filled: ${rows[0]}`);
  assert.ok(rows.slice(1).every(row => row.startsWith('  ') && !/^\s*[、。」）ー]/.test(row)), rows.join('|'));
  // Every character kept: only the hanging indent and wrap-point spaces differ.
  assert.equal(rows.join('').replace(/\s/g, ''), '>明細の日付をUTCの実行日と比べているため、翌日扱いになりました。');
  // Latin words are still never split.
  assert.deepEqual([...readerPageText('alpha beta gamma', t => t.length * 6, 6 * 11, 20)[0].split(nl)], ['alpha beta', 'gamma']);
});
