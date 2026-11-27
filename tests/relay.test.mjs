import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rmdir, unlink } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import vm from 'node:vm';
import ts from '../app/node_modules/typescript/lib/typescript.js';
import WebSocket from 'ws';
import { connectRelay } from '../bridge/relay-client.mjs';
import { makeRelayIdentity, relayRouteId } from '../bridge/relay-config.mjs';
import { createBridge } from '../bridge/server.mjs';
import { createRelay } from '../relay/server.mjs';
import * as wire from '../app/src/relay-wire.mjs';

function loadApp({ fetch, origin }) {
  const modules = new Map([['./demo', {}], ['./relay-wire.mjs', wire]]);
  for (const name of ['relay-transport', 'api', 'pairing']) {
    const source = readFileSync(new URL(`../app/src/${name}.ts`, import.meta.url), 'utf8');
    const exports = {};
    vm.runInNewContext(ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, {
      exports, require: name => modules.get(name), fetch, crypto: globalThis.crypto, atob,
      Uint8Array, TextEncoder, AbortSignal, Response, URLSearchParams,
      __BRIDGE_ORIGIN__: '', __RELAY_ORIGIN__: origin,
    });
    modules.set(`./${name}`, exports);
  }
  return { ...modules.get('./relay-transport'), ...modules.get('./api'), ...modules.get('./pairing') };
}

async function startRelay(port = 0) {
  // Keep the relay in a separate V8 process. It never receives the fixture text or
  // keys through the test harness, so its logs and heap can be checked independently.
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import { once } from 'node:events';
    import { writeHeapSnapshot } from 'node:v8';
    import { createRelay } from './relay/server.mjs';
    const { server, close } = createRelay();
    server.listen(${port}, '127.0.0.1');
    await once(server, 'listening');
    process.send(server.address().port);
    process.on('message', async ({ snapshot }) => {
      if (snapshot) return process.send(writeHeapSnapshot(snapshot));
      await close();
      process.disconnect();
    });
  `], { cwd: new URL('../', import.meta.url), stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let logs = '';
  for (const stream of [child.stdout, child.stderr]) stream.setEncoding('utf8').on('data', chunk => { logs += chunk; });
  try {
    const [actual] = await Promise.race([
      once(child, 'message'),
      once(child, 'exit').then(() => { throw new Error(`Relay exited on startup: ${logs}`); }),
    ]);
    return {
      port: actual, origin: `http://127.0.0.1:${actual}`, get logs() { return logs; },
      async snapshot(path) {
        const result = once(child, 'message');
        child.send({ snapshot: path });
        await result;
        return readFile(path);
      },
      async close() {
        if (!child.connected) return;
        const closed = once(child, 'close');
        child.send({});
        assert.equal((await closed)[0], 0, logs);
      },
    };
  } catch (error) {
    child.kill();
    throw error;
  }
}

async function waitForBridge(api) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { return await api.health(); } catch (error) {
      if (!String(error).includes('HTTP 503') &&
          !['ECONNREFUSED', 'ECONNRESET', 'UND_ERR_SOCKET'].includes(error.cause?.code)) throw error;
      await sleep(20);
    }
  }
  throw new Error('Bridge did not register with the relay');
}

test('relay, outbound bridge and app exchange encrypted JSON and binary and reject replay', async t => {
  let host = await startRelay();
  let stop;
  const scratch = await mkdtemp(join(tmpdir(), 'hud-relay-'));
  const heapPath = join(scratch, 'relay.heapsnapshot');
  t.after(async () => {
    stop?.();
    await host.close();
    await unlink(heapPath).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await rmdir(scratch);
  });

  const identity = makeRelayIdentity();
  const routeId = relayRouteId(identity.registration);
  const marker = Buffer.from('RELAY-PLAINTEXT-TEST-d4afc841d8d5c97642fa');
  const binary = Buffer.concat([Buffer.from([0, 255, 3]), marker, Buffer.from([128])]);
  const captured = [];
  const endpoint = `${host.origin}/r/${routeId}/`;
  const app = loadApp({
    origin: host.origin,
    async fetch(url, init) {
      assert.equal(url, endpoint);
      assert.equal(init.method, 'POST');
      assert.equal(init.headers.authorization, undefined);
      const request = Buffer.from(init.body);
      const res = await fetch(url, init);
      const response = Buffer.from(await res.clone().arrayBuffer());
      for (const bytes of [request, response]) assert.equal(bytes.includes(marker), false);
      captured.push(request);
      return res;
    },
  });

  let delivered = 0;
  const dispatch = ({ method, path, contentType }, bytes) => {
    if (path === '/healthz?lang=en') return { status: 200, contentType: 'application/json', bytes: Buffer.from('{"ok":true}') };
    delivered++;
    assert.equal(method, 'POST');
    if (path === '/api/say?lang=en') {
      assert.equal(contentType, 'application/json');
      assert.deepEqual(JSON.parse(bytes), { handle: marker.toString(), text: marker.toString() });
      return { status: 200, contentType: 'application/json', bytes: Buffer.from(JSON.stringify({ sent: marker.toString() })) };
    }
    assert.equal(path, '/api/synthetic/binary');
    assert.equal(contentType, 'application/octet-stream');
    assert.deepEqual(bytes, binary);
    return { status: 200, contentType, bytes };
  };

  const connect = () => connectRelay({ origin: host.origin, identity, dispatch, retryMs: 30 });
  stop = connect();
  const pairing = app.parseCode(`eho2.${routeId}.${identity.key}`);
  assert.deepEqual({ ...pairing }, { routeId, key: identity.key });
  app.setConnection({ base: await app.resolveBase(pairing), relay: pairing });
  assert.deepEqual(await waitForBridge(app.api), { ok: true });
  assert.deepEqual(await app.api.say(marker.toString(), marker.toString()), { sent: marker.toString() });
  const post = captured.at(-1);

  const transport = app.createRelayTransport(host.origin, pairing);
  const res = await transport('POST', '/api/synthetic/binary', binary, 'application/octet-stream');
  assert.equal(res.headers.get('content-type'), 'application/octet-stream');
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), binary);

  const wrong = app.createRelayTransport(host.origin, { routeId, key: makeRelayIdentity().key });
  await assert.rejects(wrong('GET', '/healthz'), /Relay request refused/);
  const submit = bytes => fetch(endpoint, {
    method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: bytes,
  });
  assert.equal((await submit(post)).status, 401);
  assert.equal(delivered, 2);
  const snapshot = await host.snapshot(heapPath);
  assert.equal(snapshot.includes(marker), false);
  assert.equal(snapshot.includes(Buffer.from(identity.key)), false);
  assert.equal(host.logs.includes(marker.toString()), false);

  const { port } = host;
  await host.close();
  host = await startRelay(port);
  assert.deepEqual(await waitForBridge(app.api), { ok: true });
  assert.equal((await submit(post)).status, 401, 'relay restart must preserve the bridge replay fence');

  stop();
  stop = connect();
  assert.deepEqual(await waitForBridge(app.api), { ok: true }, 'stale app session renegotiates after bridge restart');
  assert.equal((await submit(post)).status, 200, 'stale epoch refusal is encrypted');
  assert.equal(delivered, 2, 'an old bridge epoch cannot execute a request after restart');
});

test('the production bridge adapter serves existing routes with local module authorization', async t => {
  const relay = createRelay();
  relay.server.listen(0, '127.0.0.1');
  await once(relay.server, 'listening');
  t.after(() => relay.close());
  const origin = `http://127.0.0.1:${relay.server.address().port}`;
  const identity = makeRelayIdentity();
  const bridge = createBridge({
    token: 'fixture-direct-token', relayConfig: { url: origin }, identity,
    privateHosts: [], mailConfig: [{ id: 'work', short: 'W', tokenFile: 'fixture-token' }], beeperConfig: null,
  });
  bridge.listen(0, '127.0.0.1');
  await once(bridge, 'listening');
  t.after(() => new Promise(resolve => bridge.close(resolve)));

  const app = loadApp({ fetch, origin });
  const routeId = relayRouteId(identity.registration);
  app.setConnection({ base: origin, relay: { routeId, key: identity.key } });
  assert.deepEqual(await waitForBridge(app.api), { ok: true });
  assert.ok((await app.api.capabilities()).modules.includes('coding'));
  assert.deepEqual(await app.api.transcribe(new Uint8Array()), { text: '' });
  await assert.rejects(app.api.chat.messages('fixture'), /not found/);
  const direct = `http://127.0.0.1:${bridge.address().port}`;
  const response = await fetch(`${direct}/api/chat/messages?id=fixture`, {
    headers: { authorization: 'Bearer fixture-direct-token', 'x-relay-authenticated': 'true' },
  });
  assert.equal(response.status, 403);

  const ws = new WebSocket(`ws://127.0.0.1:${relay.server.address().port}/bridge/${routeId}`, {
    headers: { authorization: `Bearer ${makeRelayIdentity().registration}` },
  });
  ws.on('error', () => {});
  await new Promise(resolve => ws.once('close', resolve));
  assert.deepEqual(await app.api.health(), { ok: true }, 'invalid registration cannot evict a bridge');

  const endpoint = `${origin}/r/${routeId}/`;
  const preflight = await fetch(endpoint, {
    method: 'OPTIONS', headers: { origin: 'null', 'access-control-request-method': 'POST' },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
  // The relay can reject an oversized declaration before it reads any body.
  const tooBig = await new Promise((resolve, reject) => {
    const req = request(endpoint, {
      method: 'POST', headers: {
        'content-type': 'application/octet-stream', 'content-length': wire.MAX_PACKET + 1,
      },
    }, res => { res.resume(); resolve(res.statusCode); });
    req.once('error', reject);
    req.flushHeaders();
  });
  assert.equal(tooBig, 413);
  let limited = false;
  for (let i = 0; i < 64 && !limited; i++) {
    const attempt = await fetch(endpoint, {
      method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: Buffer.alloc(28),
    });
    assert.ok([401, 429].includes(attempt.status));
    limited = attempt.status === 429;
  }
  assert.equal(limited, true, 'invalid packets consume the route rate budget');
});
