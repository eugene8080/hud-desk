// Real SDK/rendering, isolated fake sessions/audio: never submit agent input.
import { createServer } from '../app/node_modules/vite/dist/node/index.js';
import { fileURLToPath } from 'node:url';
import { createBeeper, readBeeperConfig } from '../bridge/beeper.mjs';
import { createBeeperFixture } from './beeper-fixture.mjs';

const beeperFixture = createBeeperFixture();
const beeper = createBeeper(readBeeperConfig({}), {
  clientOptions: { transport: beeperFixture.transport, readToken: async () => 'fixture-token' },
});

const port = Number(process.env.ORCA_GLASS_SIM_PORT || 8791);
const moduleDelay = Number(process.env.ORCA_GLASS_SIM_MODULE_DELAY || 0);
const limit = (usedPercent, minutes) => {
  const resetsAt = Date.now() + minutes * 60000;
  return { usedPercent, resetsAt, resetDescription: '', computerResetDescription: new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Hong_Kong', weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).format(resetsAt).replace(',', '') };
};
const fixture = {
  state: 'working', source: 'claude-transcript', progress: 'Reading files', menu: null, model: 'Opus5.5',
  text: Array.from({ length: 35 }, (_, i) => `Chat line ${i + 1}: native reader scroll retention check.`).join('\n'),
  transcript: Array.from({ length: 30 }, (_, i) => `Draft line ${i + 1}: review this transcription.`).join('\n'),
  threads: [
    { handle: 'fixture', title: 'Archive retrieval', agent: 'claude', state: 'busy', workspaceId: 'ws-port', workspaceName: 'porttracker', workspaceLabel: 'porttracker' },
    { handle: 'glass', title: 'Workspace filter', agent: 'codex', state: 'idle', workspaceId: 'ws-glass', workspaceName: 'orca-glass', workspaceLabel: 'orca-glass' },
    { handle: 'settings', title: 'Review Windows settings', agent: 'codex', state: 'idle', workspaceId: 'ws-pc', workspaceName: 'pc-settings', workspaceLabel: 'pc-settings' },
  ],
  workspaces: [{ id: 'ws-port', name: 'porttracker' }, { id: 'ws-glass', name: 'orca-glass' }, { id: 'ws-pc', name: 'pc-settings' }],
  sends: [],
  usage: {
    codex: { provider: 'codex', status: 'ok', weekly: limit(63, 3192) },
    claude: { provider: 'claude', status: 'ok', session: limit(3, 120), weekly: limit(2, 3192) },
    cursor: { provider: 'cursor', status: 'ok', monthly: limit(2.02, 4320) },
  },
};
const hermesScenario = process.env.ORCA_GLASS_SIM_SCENARIO === 'hermes'
  ? await (await import('./hermes-fixture.mjs')).createHermesFixture() : null;
if (hermesScenario) Object.assign(fixture, hermesScenario);
const api = `
const timing=(module,phase)=>{if(${moduleDelay > 0})console.log('Module timing '+JSON.stringify({module,phase,at:performance.now()}));};
const timed=async(module,load)=>{timing(module,'fetch start');try{return await load();}finally{timing(module,'fetch end');}};
const request=async(query='')=>{const r=await fetch('/__fixture'+query);return r.json();};
const read=async(handle)=>{const r=await fetch('/__fixture/read?handle='+encodeURIComponent(handle));const data=await r.json();if(!r.ok)throw new Error(data.error);return data;};
const privateRequest=async(path,params,body)=>{
 const r=await fetch(path+(params?'?'+new URLSearchParams(params):''),body?{method:'POST',body:JSON.stringify(body)}:undefined);
 const data=await r.json();if(!r.ok)throw new Error(data.error);return data;
};
export const setDemo=()=>{},setApiLang=()=>{},setConnection=()=>{};
export const currentBase=()=> 'isolated simulator';
export const api={
  threads:async()=>timed('Coding',async()=>(await request('?module=coding')).threads),workspaces:async()=>(await request()).workspaces,
  thread:read,history:read,
  activity:async(handle)=>{const r=await fetch('/__fixture/activity?handle='+encodeURIComponent(handle));return r.json();},
  health:async()=>({ok:true}),capabilities:()=>privateRequest('/api/capabilities', new URLSearchParams(location.search).has('legacyModules')?{legacyModules:'1'}:undefined),
  chat:{
   networks:()=>privateRequest('/api/chat/networks'),
   list:(networks,page)=>timed('Chat',()=>privateRequest('/api/chat/list',{networks:networks.join(','),page})),
   messages:id=>privateRequest('/api/chat/messages',{id}),
   send:(chatId,text)=>privateRequest('/api/chat/send',null,{chatId,text}),
  },
  mail:{
   accounts:()=>privateRequest('/api/mail/accounts'),
   labels:(account)=>privateRequest('/api/mail/labels',{account}),
   threads:(filter,page)=>timed('Email',()=>privateRequest('/api/mail/threads',{filter:filter.join(','),page,size:'8'})),
   thread:(account,id)=>privateRequest('/api/mail/thread',{account,id}),
   read:(account,threadId)=>privateRequest('/api/mail/read',null,{account,threadId}),
  },
  usage:async()=>(await request()).usage,
  transcribe:async()=>({text:(await request()).transcript}),
  choice:async(handle,menuId,value)=>{const r=await fetch('/__fixture/choice',{method:'POST',body:JSON.stringify({handle,menuId,value})});const data=await r.json();if(!r.ok)throw new Error(data.error);return data;},
  say:async(handle,text)=>{const r=await fetch('/__fixture/send',{method:'POST',body:JSON.stringify({handle,text})});const data=await r.json();if(!r.ok)throw new Error(data.error);return {sent:text};}
};`;
const shim = `<script>
const timer=setInterval(()=>{
 const host=window.flutter_inappwebview;if(!host?.callHandler)return;clearInterval(timer);
 const original=host.callHandler.bind(host);
 host.callHandler=async(name,...args)=>{
  let p;try{p=typeof args[0]==='string'?JSON.parse(args[0]):args[0];}catch{}
  if(p?.method)console.log('Native call',JSON.stringify(p));
  if(new URLSearchParams(location.search).has('rejectAligned') && p?.method==='rebuildPageContainer' && p.data?.textObject?.some(c=>c.containerName==='menu-right'))return false;
  if(p?.method==='audioControl'){
   if(JSON.stringify(p.data).includes('true'))setTimeout(()=>window.dispatchEvent(new CustomEvent('evenHubEvent',{detail:{audioEvent:{audioPcm:Array(32000).fill(0)}}})),100);
   return true;
  }
  const content=p?.method==='rebuildPageContainer'?p.data.textObject?.find(c=>c.containerName==='head')?.content:p?.data?.containerName==='head'?p.data.content:'';
  const module=/^\\[(Coding|Email|Chat)\\] /.exec(content||'')?.[1];
  const timing=phase=>{if(${moduleDelay > 0}&&module)console.log('Module timing '+JSON.stringify({module,phase,at:performance.now()}));};
  timing(p?.method==='rebuildPageContainer'?'render start':'head');
  const result=await original(name,...args);
  if(p?.method==='rebuildPageContainer')timing('render end');
  return result;
 };
},10);
</script>`;
const server = await createServer({
  root: fileURLToPath(new URL('../app/', import.meta.url)), configFile: false,
  define: { __BRIDGE_ORIGIN__: '""', __APP_VERSION__: JSON.stringify(JSON.parse((await import('node:fs')).readFileSync(new URL('../app/app.json', import.meta.url), 'utf8')).version) },
  server: { host: '127.0.0.1', port, strictPort: true },
  plugins: [{
    name: 'isolated-native-simulator', enforce: 'pre',
    resolveId(id) { if (id === './api') return '\0fixture-api'; },
    load(id) { if (id === '\0fixture-api') return api; },
    transformIndexHtml(html) { return html.replace('<head>', '<head>' + shim); },
    configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/__fixture') && !req.url?.startsWith('/api/')) return next();
        try {
          const url = new URL(req.url, 'http://127.0.0.1');
          if (moduleDelay > 0 && (['/api/mail/threads', '/api/chat/list'].includes(url.pathname) || url.searchParams.get('module') === 'coding')) {
            await new Promise(resolve => setTimeout(resolve, moduleDelay));
          }
          if (url.pathname.startsWith('/api/')) {
            let body;
            if (req.method === 'POST') {
              let raw = ''; for await (const part of req) raw += part;
              body = JSON.parse(raw);
            }
            let result;
            if (url.pathname.startsWith('/api/chat/')) {
              const route = beeper.routes[`${req.method} ${url.pathname}`];
              if (!route) { res.writeHead(404); res.end(); return; }
              result = await route(url.searchParams, body);
            } else {
              const { demoCall } = await vite.ssrLoadModule('/src/demo.ts');
              result = url.pathname === '/api/capabilities' && url.searchParams.has('legacyModules') ? { voice: true } : demoCall('en', req.method, req.url, body);
            }
            res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(result)); return;
          }
          if (req.method === 'GET' && ['/__fixture/read', '/__fixture/activity'].includes(url.pathname)) {
            const handle = url.searchParams.get('handle');
            const result = url.pathname.endsWith('/read')
              ? hermesScenario ? await hermesScenario.read(handle) : { text: fixture.text, menu: fixture.menu, progress: fixture.progress, source: fixture.source, model: fixture.model }
              : hermesScenario ? await hermesScenario.activity(handle) : { state: fixture.state };
            res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(result)); return;
          }
          if (req.method === 'POST') {
            let body = ''; for await (const part of req) body += part;
            const data = JSON.parse(body);
            if (req.url === '/__fixture/choice') {
              if (fixture.menu?.id !== data.menuId || !fixture.menu.options.some(o => o.value === data.value)) throw new Error('Question changed. Nothing sent.');
              const sent = fixture.menu.options.find(o => o.value === data.value).label;
              fixture.sends.push({ ...data, kind: 'choice' });
              fixture.menu = null;
              fixture.state = 'working';
              res.setHeader('content-type', 'application/json');
              res.end(JSON.stringify({ sent }));
              return;
            } else if (req.url === '/__fixture/send') {
              if (hermesScenario) await hermesScenario.send(data.handle, data.text);
              else fixture.sends.push(data);
            }
            else {
              if ('menu' in data) fixture.menu = data.menu;
              for (const key of ['threads', 'workspaces']) if (Array.isArray(data[key])) fixture[key] = data[key];
              if (data.usage && typeof data.usage === 'object') fixture.usage = data.usage;
              for (const key of ['state', 'text', 'source', 'transcript', 'progress', 'model']) {
                if (typeof data[key] === 'string') fixture[key] = data[key];
              }
            }
          }
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(fixture));
        } catch (error) { res.statusCode = 400; res.end(JSON.stringify({ error: error.message })); }
      });
    },
  }],
});
await server.listen();
console.log(`Isolated simulator fixture: http://127.0.0.1:${port}/?code=demo&lang=en`);
