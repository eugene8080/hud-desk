import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import ts from '../app/node_modules/typescript/lib/typescript.js';

function pairing(origin, fetch, relayOrigin = '') {
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL('../app/src/pairing.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, { exports, __BRIDGE_ORIGIN__: origin, __RELAY_ORIGIN__: relayOrigin, fetch, require: () => ({}) });
  return exports;
}
const noNetwork = () => { throw new Error('Unexpected network request'); };

test('beta connects to its whitelisted Tailscale origin without any discovery request', async () => {
  const api = pairing('https://pc.example:8443', noNetwork);
  assert.equal(await api.resolveBase({ topic: 'private', token: 'secret' }), 'https://pc.example:8443');
});

test('a build without an origin resolves to nothing and never asks a discovery service', async () => {
  const api = pairing('', noNetwork);
  assert.equal(await api.resolveBase({ topic: 'private', token: 'secret' }), null);
  assert.deepEqual({ ...api.parseCode('eho1.topic-1.token_2') }, { topic: 'topic-1', token: 'token_2' });
  assert.equal(api.parseCode('not a code'), null);
});

test('the app manifest allows only the HTTPS bridge origin, no tunnel or discovery hosts', () => {
  const manifest = JSON.parse(readFileSync(new URL('../app/app.json', import.meta.url), 'utf8'));
  const whitelist = manifest.permissions.find(p => p.name === 'network').whitelist;
  assert.equal(whitelist.length, 1);
  assert.match(whitelist[0], /^https:\/\/[a-z0-9.-]+\.ts\.net:8443$/);
});

test('eho2 resolves only to the configured relay and requires canonical key bytes', async () => {
  const id = Buffer.alloc(32, 10).toString('base64url');
  const key = Buffer.alloc(32, 20).toString('base64url');
  const code = `eho2.${id}.${key}`;
  const direct = 'https://pc.example:8443';
  const origin = 'https://relay.example';
  const app = pairing(direct, noNetwork, origin);
  assert.equal(await app.resolveBase(app.parseCode(code)), origin);
  assert.equal(await app.resolveBase(app.parseCode('eho1.topic.token')), direct);
  assert.equal(await pairing(direct, noNetwork).resolveBase(app.parseCode(code)), null);
  assert.equal(app.parseCode(code + '='), null);
  assert.equal(app.parseCode(code.slice(0, -1) + 'B'), null);
});

// 2026-11-27: a bridge address typed on the phone, used instead of the build's origin for eho1 codes.
test('a typed bridge address must be a bare HTTPS origin and wins over the build origin', async () => {
  const api = pairing('https://pc.example:8443', noNetwork);
  assert.equal(api.parseOrigin('https://Their-PC.tail1234.ts.net:8443/'), 'https://their-pc.tail1234.ts.net:8443');
  assert.equal(api.parseOrigin('https://relay.example.com:443'), 'https://relay.example.com');
  for (const bad of ['http://pc.example:8443', 'https://pc.example/path', 'https://user@pc.example', 'https://pc.example:99999',
    'https://localhost:8443', 'https://pc.example?x=1', 'pc.example:8443', 'javascript:alert(1)', '']) {
    assert.equal(api.parseOrigin(bad), null, bad);
  }
  const direct = { topic: 'private', token: 'secret' };
  assert.equal(await api.resolveBase(direct, 'https://their-pc.tail1234.ts.net:8443'), 'https://their-pc.tail1234.ts.net:8443');
  assert.equal(await api.resolveBase(direct, 'not an address'), 'https://pc.example:8443');
  assert.equal(await api.resolveBase(direct, ''), 'https://pc.example:8443');
});
