// Render the real app and native SDK with synthetic data for store screenshots.
// No real bridge, credentials, agent process, or microphone is used.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from '../app/node_modules/vite/dist/node/index.js';
import { createImaging } from '../bridge/image.mjs';

const version = JSON.parse(readFileSync(new URL('../app/app.json', import.meta.url), 'utf8')).version;
const samples = [
  { handle: 'store-a12c34', title: 'Polish search UI', agent: 'cursor', state: 'busy', workspaceId: 'site', workspaceName: 'website' },
  { handle: 'store-b56d78', title: 'Review project', agent: 'pi', state: 'idle', workspaceId: 'docs', workspaceName: 'docs' },
  { handle: 'store-c90e12', title: 'Release notes', agent: 'claude', state: 'idle', unread: true, workspaceId: 'glass', workspaceName: 'orca-glass' },
  { handle: 'store-d34f56', title: 'Simplify sign-in', agent: 'codex', state: 'idle', unread: true, workspaceId: 'app', workspaceName: 'sample-app' },
  { handle: 'store-e78a90', title: 'Retry the sync', agent: 'opencode', state: 'busy', workspaceId: 'app', workspaceName: 'sample-app' },
  { handle: 'store-f12g34', title: 'Architecture map', agent: 'openclaude', state: 'idle', workspaceId: 'glass', workspaceName: 'orca-glass' },
  { handle: 'store-g56h78', title: 'API sketch', agent: 'claude', state: 'busy', workspaceId: 'archive', workspaceName: 'archive' },
  { handle: 'hermes:r4f2a1', title: 'Research notes', agent: 'hermes', state: 'idle', workspaceId: 'hermes-bot:research', workspaceName: 'Research bot', hermesGroup: 'bot' },
  { handle: 'hermes:s7d3b9', title: 'Plan next steps', agent: 'hermes', state: 'idle', workspaceId: 'hermes-session:desktop', workspaceName: 'Desktop', hermesGroup: 'session' },
  { handle: 'hermes:j9c8e5', title: 'Morning summary', agent: 'hermes', state: 'idle', workspaceId: 'hermes-job:summary', workspaceName: 'Morning summary', hermesGroup: 'job' },
];
const workspaces = [
  { id: 'app', name: 'sample-app', lastActivityAt: 500 },
  { id: 'glass', name: 'orca-glass', lastActivityAt: 400 },
  { id: 'site', name: 'website', lastActivityAt: 300 },
  { id: 'docs', name: 'docs', lastActivityAt: 200 },
  { id: 'archive', name: 'archive', lastActivityAt: 100 },
  { id: 'hermes-bot:research', name: 'Research bot', hermes: 'bot' },
  { id: 'hermes-session:desktop', name: 'Desktop', hermes: 'session' },
  { id: 'hermes-job:summary', name: 'Morning summary', hermes: 'job' },
];
const nativeText = '/ Simplify sign-in and keep the existing behavior.\n> The sign-in flow now shares one session check.\n  Changes ready for review:\n  - Expired sessions show a clear message.\n  - Existing sessions stay signed in.\n  - The reset link works with keyboard input.\n  Validation:\n  1. All 42 tests pass.\n  2. No new dependencies.\n  3. Ready for your review.';
const tableText = '/ Plan the rollout steps.\n> Here is a compact checklist:\n  | Step        | Owner  | Status |\n  |-------------|--------|--------|\n  | Unit tests  | Agent  | Pass   |\n  | Docs update | You    | Ready  |\n  | Beta upload | Script | Done   |\n  Notes:\n  - Table columns stay aligned in every pixel font.\n  - Wrapped lines hang under the text after a marker, so long list items stay easy to follow on the glasses.\n  Next: confirm on G2 with fictional data only.';
const denseText = [
  '/ Review the API sketch and tell me what is left before the beta.',
  '> I read the sketch, the route table and the tests. The shape is good; four items are left.',
  '  | Route              | Method | Auth  | Tests | Status            |',
  '  |--------------------|--------|-------|-------|-------------------|',
  '  | /api/sessions      | GET    | token | 12    | Done              |',
  '  | /api/sessions/:id  | GET    | token | 9     | Done              |',
  '  | /api/reply         | POST   | token | 7     | Needs rate limit  |',
  '  | /api/export        | GET    | token | 0     | Not started       |',
  '  | /api/health        | GET    | none  | 2     | Done              |',
  '  Left before the beta:',
  '  1. Rate limit /api/reply: one send per request id, ten a minute per token.',
  '  2. Write /api/export and its tests; stream the file instead of reading it into memory.',
  '  3. Return 400 with a short reason for bad input; today some paths answer 500.',
  '  4. Move the page size (8) into the config so the glasses and the phone use the same value.',
  '  Not in scope: the admin routes and the old v1 paths; they stay as they are.',
  '  Messages from the team, with English:',
  '  - 明日の朝までにテストを直します。',
  '    (I will fix the tests by tomorrow morning.)',
  '  - 呢個 API 下個禮拜先上線，唔使急。',
  '    (This API only goes live next week, no rush.)',
  '/ Do 1 and 3 now, then run the tests.',
  '> Working on it: adding the rate limit first, then the error answers.',
].join('\n');
const diagramText = "/ Draw how a voice reply gets from the glasses to the agent.\n> Here is the path, end to end:\n  ┌──────────────┐         ┌──────────────┐         ┌──────────────┐\n  │ G2 glasses   │──BLE───▶│ Even app     │─Tailnet▶│ HUD Desk     │\n  │ 576x288 HUD  │         │ on the phone │  HTTPS  │ bridge on PC │\n  └──────────────┘         └──────────────┘         └───────┬──────┘\n                                                            │\n         ┌───────────────┬───────────────┬───────────────┬──┴────────────┐\n  ┌──────┴──────┐ ┌──────┴──────┐ ┌──────┴──────┐ ┌──────┴──────┐ ┌──────┴──────┐\n  │ Orca        │ │ Gmail       │ │ Beeper      │ │ Whisper     │ │ Ollama      │\n  │ agents      │ │ API         │ │ Desktop     │ │ voice       │ │ vision, EN  │\n  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘\n  Voice, pictures and translation run on your PC.\n/ What leaves the PC?\n> Only what each service needs:\n  | Part     | Runs on          | Talks to                 |\n  |----------|------------------|--------------------------|\n  | Whisper  | your PC          | nothing outside          |\n  | Ollama   | your PC          | nothing outside          |\n  | Gmail    | Google           | the bridge, with OAuth   |\n  | Beeper   | Beeper Desktop   | your chat networks       |";
const diffText = "/ The sync job fails when the vendor rate-limits us. Add retry with backoff.\n> Found it: fetchPrices() throws on 429 and the whole run stops. Patching src/sync.ts:\n  ```diff\n  @@ -41,7 +41,12 @@ export async function fetchPrices(region: Region) {\n  -  const res = await fetch(url, { headers });\n  -  if (!res.ok) throw new Error(`HTTP ${res.status}`);\n  +  const res = await retry(() => fetch(url, { headers }), {\n  +    tries: 5, baseMs: 250, factor: 2, jitter: 0.2,\n  +    retryOn: (r) => r.status === 429 || r.status >= 500,\n  +  });\n  +  if (!res.ok) log.warn('prices', region, res.status);\n  ```\n  $ npm test -- sync\n  PASS  tests/sync.test.ts (12 tests)\n  PASS  tests/retry.test.ts (7 tests)\n  FAIL  tests/report.test.ts > totals match the vendor file\n  Tests: 41 passed, 1 failed, 42 total\n> One report test still expects the old error text; updating it now.";
const choiceMenu = {
  id: 'store-choice-1',
  question: 'How should we ship this UI refresh?',
  options: [
    { value: '1', label: 'Beta channel first' },
    { value: '2', label: 'Wait for G2 checks' },
    { value: '3', label: 'Type something' },
  ],
};
const byHandle = Object.fromEntries([
  ['store-a12c34', { text: nativeText, model: 'Composer 2.5', menu: null, progress: 'Editing files' }],
  ['store-b56d78', { text: nativeText, model: 'Qwopus-Pi-128k', menu: null }],
  ['store-c90e12', { text: nativeText, model: 'Opus 5.5', menu: choiceMenu }],
  ['store-d34f56', { text: tableText, model: 'GPT-6.1-Sol low', menu: null }],
  ['store-e78a90', { text: diffText, model: 'Qwopus3.8-27B-Coder-Flash', menu: null, progress: 'Running tests' }],
  ['store-f12g34', { text: diagramText, model: 'GPT-5.6 Sol high', menu: null }],
  ['store-g56h78', { text: denseText, model: 'Opus 5.5', menu: null, progress: 'Editing files' }],
  ['hermes:r4f2a1', { text: '/ Summarize the competitor notes.\n> Three themes stand out: pricing, onboarding and offline use.', model: 'Hermes Auto', menu: null }],
  ['hermes:s7d3b9', { text: '/ Draft the afternoon plan.\n> Focus on store screenshots, then description.', model: 'Hermes Auto', menu: null }],
  ['hermes:j9c8e5', { text: '/ Morning summary\n> Overnight tests passed. No live sessions touched.', model: 'Hermes Auto', menu: null }],
]);
const defaultThread = { text: nativeText, model: 'GPT-6.1-Sol low', menu: null };
const working = new Set(['store-a12c34', 'store-e78a90', 'store-g56h78']);
const limit = (usedPercent, minutes) => ({ usedPercent, resetsAt: Date.now() + minutes * 60000, computerResetDescription: 'Fri 9:00 AM', resetDescription: 'Fri 9:00 AM' });
const usage = {
  codex: { provider: 'codex', status: 'ok', session: limit(18, 135), weekly: limit(35, 6120) },
  claude: { provider: 'claude', status: 'ok', session: limit(12, 180), weekly: limit(28, 4320) },
  cursor: { provider: 'cursor', status: 'ok', monthly: limit(24, 20160) },
};
// Email, Chat and pictures (2026-11-27 store refresh). All fictional: a newsletter with pictures,
// a renovation checklist chat in Chinese with line-by-line English, and a product photo (below).
// The picture: a Mandelbrot set drawn by ffmpeg (Eugene swapped it in for a kettle product photo,
// 2026-11-27, so the listing carries no third-party image), kept in the gitignored .local/store-assets. Every view comes from the bridge's own picture code; the AI Readout
// is the local vision model's answer, cached next to the photo so later starts do not ask again.
const pictureFile = new URL('../.local/store-assets/fractal.png', import.meta.url);
const readoutFile = new URL('../.local/store-assets/fractal-readout.txt', import.meta.url);
const local = (() => { try { return JSON.parse(readFileSync(new URL('../bridge/config.local.json', import.meta.url), 'utf8')); } catch { return {}; } })();
const imaging = createImaging({ ffmpeg: local.ffmpegPath ?? local.beeper?.ffmpegPath, model: local.visionModel ?? local.beeper?.translationModel });
const pictureBytes = readFileSync(pictureFile);
const load = async () => pictureBytes;
const views = { fit: await imaging.render('picture', load, { view: 'fit' }),
  outline: await imaging.render('picture', load, { view: 'outline' }), zoom: [] };
const firstZoom = await imaging.render('picture', load, { view: 'zoom', region: 0 });
for (let region = 0; region < firstZoom.regions; region++) views.zoom.push(await imaging.render('picture', load, { view: 'zoom', region }));
const fractalBytes = readFileSync(new URL('../.local/store-assets/fractal.png', import.meta.url));
const fractalLoad = async () => fractalBytes;
const fractal = { fit: await imaging.render('fractal', fractalLoad, { view: 'fit' }),
  outline: await imaging.render('fractal', fractalLoad, { view: 'outline' }), zoom: [] };
const fractalZoom = await imaging.render('fractal', fractalLoad, { view: 'zoom', region: 0 });
for (let region = 0; region < fractalZoom.regions; region++) fractal.zoom.push(await imaging.render('fractal', fractalLoad, { view: 'zoom', region }));
// A news-style line chart with invented data (scripts/make-store-chart.py). Eugene chose this
// look-alike over a newsletter's real chart for the README and store (2026-11-27): same genre, nothing
// copied. Views and the AI Readout come from the bridge's picture code and the local vision model; the
// readout is cached next to the chart.
const chartBytes = readFileSync(new URL('../.local/store-assets/markets-chart.png', import.meta.url));
const chartLoad = async () => chartBytes;
const chart = { fit: await imaging.render('chart', chartLoad, { view: 'fit' }),
  outline: await imaging.render('chart', chartLoad, { view: 'outline' }), zoom: [] };
const chartZoom = await imaging.render('chart', chartLoad, { view: 'zoom', region: 0 });
for (let region = 0; region < chartZoom.regions; region++) chart.zoom.push(await imaging.render('chart', chartLoad, { view: 'zoom', region }));
const chartReadoutFile = new URL('../.local/store-assets/markets-chart-readout.txt', import.meta.url);
let chartReadout;
try { chartReadout = readFileSync(chartReadoutFile, 'utf8'); } catch {
  chartReadout = (await imaging.render('chart', chartLoad, { view: 'read' })).text;
  writeFileSync(chartReadoutFile, chartReadout);
}
// AI Labels (1.0.96): the chart's words drawn back on it in Scientifica. The answer (picture plus
// labels) is cached next to the chart like the readout, so later starts skip the model call.
const chartLabelsFile = new URL('../.local/store-assets/markets-chart-labels.json', import.meta.url);
try { chart.labels = JSON.parse(readFileSync(chartLabelsFile, 'utf8')); } catch {
  chart.labels = await imaging.render('chart', chartLoad, { view: 'labels' });
  writeFileSync(chartLabelsFile, JSON.stringify(chart.labels));
}
let readout;
try { readout = readFileSync(readoutFile, 'utf8'); } catch {
  readout = (await imaging.render('picture', load, { view: 'read' })).text;
  writeFileSync(readoutFile, readout);
}
const now = Date.now();
const mailThreads = [
  { account: 'work', id: 'markets', from: 'Market Desk', subject: 'Evening wrap: Nimbus back above its offer price', date: now - 12 * 60000, unread: true, count: 1 },
  { account: 'work', id: 'news', from: 'Field Notes Daily', subject: 'Morning briefing: picture of the week', date: now - 25 * 60000, unread: true, count: 1 },
  { account: 'work', id: 'plan', from: 'Workshop Desk', subject: 'Workshop schedule for Thursday', date: now - 3 * 3600000, unread: true, count: 2 },
  { account: 'work', id: 'pack', from: 'Trail Team', subject: 'Revised packing list', date: now - 7 * 3600000, unread: false, count: 1 },
  { account: 'work', id: 'room', from: 'Facilities', subject: 'A new meeting room', date: now - 26 * 3600000, unread: false, count: 1 },
  { account: 'work', id: 'map', from: 'Survey Office', subject: 'Map corrections', date: now - 50 * 3600000, unread: false, count: 3 },
];
const mailText = {
  markets: 'Market Desk\nNimbus Robotics finished its second week of trading at $44.70, back above its $40 offer price after closing below it on Mar. 10.\n\n[[img:0]]\nThe chart shows each daily close since the listing.',
  news: 'Field Notes Daily\n[[img:0]]\nGood morning. This week: a fractal to stare at, the new trail map, and the spring workshop list is open.\n\nPicture of the week\n[[img:1]]\nA Mandelbrot set at 1,000 iterations: zoom into any edge and the coastline never ends.\n\nToday\n• Trail map: corrected routes for the east loop\n• Workshop sign-ups close on Friday\n• Volunteer meeting at 4 pm',
};
const chats = [
  { id: 'site', title: 'Renovation: House B', date: now - 20 * 60000, unread: true, network: 'WhatsApp' },
  { id: 'trail', title: 'Trail work', date: now - 2 * 3600000, unread: true, network: 'Signal' },
  { id: 'gen', title: 'Generative art', date: now - 3 * 3600000, unread: false, network: 'Telegram' },
  { id: 'reading', title: 'Reading group', date: now - 5 * 3600000, unread: false, network: 'Telegram' },
  { id: 'garden', title: 'Garden planning', date: now - 26 * 3600000, unread: false, network: 'WhatsApp' },
  { id: 'equip', title: 'Equipment', date: now - 50 * 3600000, unread: false, network: 'Signal' },
];
const siteList = 'Site walk notes\n• 2/F 走廊窗好緊, 開唔到\n• G/F 廚房窗要換鉸\n• 1/F corridor window - cannot tilt\n• LG/F 泳池門鎖唔到';
const siteLines = [null, '2/F corridor window is very tight, cannot be opened', 'G/F kitchen window needs new hinges', null, 'LG/F pool door cannot be locked'];
const chatMessages = {
  site: [
    { id: 's1', own: true, from: '', date: now - 40 * 60000, text: 'Can you list what still needs fixing?' },
    { id: 's2', own: false, from: 'Site team', date: now - 20 * 60000, text: siteList },
  ],
  gen: [
    { id: 'g0', own: false, from: 'Mira', date: now - 3 * 3600000 - 60000, text: 'Rendered the whole set at 1600x800 tonight.' },
    { id: 'g1', own: false, from: 'Mira', date: now - 3 * 3600000, text: 'Mandelbrot, 1,000 iterations', media: 'Photo', image: true },
  ],
};
const api = `
const byHandle = ${JSON.stringify(byHandle)};
const defaultThread = ${JSON.stringify(defaultThread)};
const working = new Set(${JSON.stringify([...working])});
export const setDemo=()=>{},setApiLang=()=>{},setConnection=()=>{};
const views=${JSON.stringify(views)};
const fractal=${JSON.stringify(fractal)};
const readout=${JSON.stringify(readout)};
const chart=${JSON.stringify(chart)};
const chartReadout=${JSON.stringify(chartReadout)};
const chartView=(request)=>request.view==='read'?{text:chartReadout}:request.view==='labels'?chart.labels:request.view==='zoom'?chart.zoom[Math.min(request.region||0,chart.zoom.length-1)]:request.view==='outline'?chart.outline:chart.fit;
const pick=(v,request)=>request.view==='zoom'?v.zoom[Math.min(request.region||0,v.zoom.length-1)]:request.view==='outline'?v.outline:request.view==='read'?{text:'A Mandelbrot set: a black cardioid with a round bulb on its left and smaller bulbs around it, on a lighter background.'}:v.fit;
const view=(request)=>request.view==='read'?{text:readout}:request.view==='zoom'?views.zoom[Math.min(request.region||0,views.zoom.length-1)]:request.view==='outline'?views.outline:views.fit;
export const currentBase=()=> 'store preview (sample data)';
export const api={
  threads:async()=>${JSON.stringify(samples)},
  thread:async(handle)=>{const row=byHandle[handle]||defaultThread;return {text:row.text,menu:row.menu??null,progress:row.progress??'',model:row.model};},
  history:async(handle)=>{const row=byHandle[handle]||defaultThread;return {text:row.text,source:'codex-transcript',model:row.model};},
  activity:async(handle)=>({state:working.has(handle)?'working':'waiting',elapsedSeconds:working.has(handle)?83:null}),
  health:async()=>({ok:true}),
  capabilities:async()=>({voice:true,images:true,imageRead:true,imageLabels:true,modules:['coding','email','chat'],chatFeatures:{transcribe:true,translate:true}}),
  historyImage:async(handle,n,request={})=>view(request),
  mail:{
    accounts:async()=>[{id:'work',short:'W',address:'me@example.com',ok:true}],
    labels:async()=>[{id:'INBOX',name:'Inbox',unread:3},{id:'Label_1',name:'Newsletters',unread:1},{id:'Label_2',name:'Projects',unread:1}],
    threads:async(filter,page,size=8)=>({items:page?[]:${JSON.stringify(mailThreads)}.slice(0,size),hasMore:false,unread:3,loading:false}),
    thread:async(account,id)=>{const row=${JSON.stringify(mailThreads)}.find(t=>t.id===id);const text=${JSON.stringify(mailText)}[id]||'The updated notes are ready for the next meeting.';
      return {subject:row.subject,messages:[{id:id+'-1',from:row.from,to:'me@example.com',cc:'',date:row.date,text,images:id==='news'?[{remote:0,name:'Field Notes Daily'},{remote:1,name:'Picture of the week'}]:id==='markets'?[{remote:0,name:'Nimbus Robotics share price'}]:undefined}]};},
    read:async()=>({ok:true}),modify:async()=>({ok:true}),
    compose:async()=>({to:'"Field Notes Daily" <desk@example.com>',cc:'',subject:'Re: Morning briefing'}),
    image:async(account,message,ref,request={})=>message==='markets-1'?chartView(request):view(request),
    send:async()=>{throw new Error('Store preview: sending is disabled.');},
  },
  chat:{
    networks:async()=>['Signal','Telegram','WhatsApp'],
    list:async(picks,page)=>({items:page?[]:${JSON.stringify(chats)},hasMore:false,unread:2}),
    messages:async id=>({messages:${JSON.stringify(chatMessages)}[id]||[{id:'x1',own:false,from:'Fixture sender',date:${now},text:'The sample schedule is ready for review.'}]}),
    translate:async(chatId,ids)=>({items:ids.map(id=>id==='s2'?{id,textLines:${JSON.stringify(siteLines)}}:{id,textLines:null})}),
    transcribe:async()=>({text:'',language:''}),
    image:async(chatId,messageId,request={})=>chatId==='gen'?pick(fractal,request):view(request),
    read:async()=>({ok:true}),
    send:async()=>{throw new Error('Store preview: sending is disabled.');},
  },
  transcribe:async()=>({text:'Looks good. Add a test for expired sessions, then show me the diff before merging.'}),
  say:async()=>{throw new Error('Store preview: sending is disabled.');},
  choice:async()=>{throw new Error('Store preview: choices are disabled.');},
  usage:async()=>(${JSON.stringify(usage)}),
  providers:async()=>[{id:'codex',models:['default'],ok:true,note:'Ready'}],
  workspaces:async()=>${JSON.stringify(workspaces)},
  prompts:async()=>['Start without a prompt','Run tests and report','Summarize changes'],
  startSession:async()=>{throw new Error('Store preview: launching is disabled.');},
};`;
// Intercept only microphone requests. Native rendering and gestures stay real.
const shim = `<script>
const timer=setInterval(()=>{
 const host=window.flutter_inappwebview;if(!host?.callHandler)return;clearInterval(timer);
 const original=host.callHandler.bind(host);
 host.callHandler=async(name,...args)=>{
  let p;try{p=typeof args[0]==='string'?JSON.parse(args[0]):args[0];}catch{}
  if(p?.method)console.log('Native call',JSON.stringify(p));
  // The app reads its language from storage, not the URL: seed it once from ?lang=ja|en.
  if(p?.method==='getLocalStorage'&&['ja','en'].includes(new URLSearchParams(location.search).get('lang'))&&JSON.stringify(p.data).includes('"lang"')&&!window.__langSeeded){
   window.__langSeeded=true;
   const q={...p,method:'setLocalStorage',data:{...p.data,value:new URLSearchParams(location.search).get('lang')}};
   await original(name,typeof args[0]==='string'?JSON.stringify(q):q,...args.slice(1));
  }
  if(p?.method==='audioControl'){
   if(JSON.stringify(p.data).includes('true'))setTimeout(()=>window.dispatchEvent(new CustomEvent('evenHubEvent',{detail:{audioEvent:{audioPcm:Array(32000).fill(0)}}})),100);
   return true;
  }
  return original(name,...args);
 };
},10);
</script>`;
const server = await createServer({
  root: fileURLToPath(new URL('../app/', import.meta.url)), configFile: false,
  define: { __BRIDGE_ORIGIN__: '""', __APP_VERSION__: JSON.stringify(version) },
  server: { host: '127.0.0.1', port: 8792, strictPort: true },
  plugins: [{
    name: 'store-sample-data', enforce: 'pre',
    resolveId(id) { if (id === './api') return '\0store-api'; },
    load(id) { if (id === '\0store-api') return api; },
    transformIndexHtml(html) { return html.replace('<head>', '<head>' + shim); },
  }],
});
await server.listen();
console.log(`HUD Desk ${version} store preview: http://127.0.0.1:8792/?code=demo&lang=en`);
console.log('Japanese preview URL: http://127.0.0.1:8792/?code=demo&lang=ja');
console.log('Synthetic data only. Sending and session creation are disabled.');
