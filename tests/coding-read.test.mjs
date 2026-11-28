import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import ts from '../app/node_modules/typescript/lib/typescript.js';

// app/src/coding-read.ts has only a type import, so it runs in a bare context after transpiling.
const read = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../app/src/coding-read.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: read });
// The vm context has its own Object prototype; compare plain copies so deepEqual checks values only.
const plain = value => JSON.parse(JSON.stringify(value));

test('Orca rows follow Orca\'s bell until they are opened on the glasses', () => {
  const row = { handle: 'term_a', state: 'idle', unread: true, activityAt: 100, lastOutputAt: 120 };
  assert.equal(read.readMarker(row, {}), '/');
  assert.equal(read.readMarker({ ...row, unread: false }, {}), '-');
  // Opened here at activity 100: read, although Orca still shows its bell.
  const seen = read.markSeen(row, {});
  assert.deepEqual(plain(seen), { term_a: 100 });
  assert.equal(read.readMarker(row, seen), '-');
  // New activity after that: Orca's flag decides again.
  assert.equal(read.readMarker({ ...row, activityAt: 150 }, seen), '/');
  assert.equal(read.readMarker({ ...row, activityAt: 150, unread: false }, seen), '-');
});

test('rows without an Orca flag start read and turn unread on new output', () => {
  const row = { handle: 'claude:1', state: 'idle', lastOutputAt: 500 };
  assert.equal(read.readMarker(row, {}), '-');
  const seen = read.withBaseline([row], {});
  assert.deepEqual(plain(seen), { 'claude:1': 500 });
  assert.equal(read.readMarker(row, seen), '-');
  assert.equal(read.readMarker({ ...row, lastOutputAt: 501 }, seen), '/');
  // Opening it records the new output as seen.
  const opened = read.markSeen({ ...row, lastOutputAt: 501 }, seen);
  assert.equal(read.readMarker({ ...row, lastOutputAt: 501 }, opened), '-');
});

test('working and unknown sessions keep their own marks', () => {
  assert.equal(read.readMarker({ handle: 'x', state: 'busy', unread: true }, {}), '');
  assert.equal(read.readMarker({ handle: 'x', state: 'unknown', unread: true }, {}), '?');
  assert.equal(read.isUnread({ handle: 'x', state: 'busy', unread: true }, {}), false);
});

test('baseline and mark helpers return the same map when nothing changes', () => {
  const seen = { 'codex:1': 10 };
  assert.equal(read.withBaseline([{ handle: 'codex:1', state: 'idle', lastOutputAt: 20 }], seen), seen);
  // Orca rows get no baseline: Orca decides until the row is opened here.
  assert.equal(read.withBaseline([{ handle: 'term_b', state: 'idle', unread: false, activityAt: 5 }], seen), seen);
  assert.equal(read.markSeen({ handle: 'codex:1', state: 'idle', lastOutputAt: 5 }, seen), seen);
});

test('the stored map keeps the newest stamps and drops damaged values', () => {
  const many = Object.fromEntries(Array.from({ length: read.SEEN_LIMIT + 5 }, (_, i) => [`h${i}`, i]));
  const kept = read.parseSeen(JSON.stringify(many));
  assert.equal(Object.keys(kept).length, read.SEEN_LIMIT);
  assert.equal('h0' in kept, false);
  assert.equal(kept[`h${read.SEEN_LIMIT + 4}`], read.SEEN_LIMIT + 4);
  assert.deepEqual(plain(read.parseSeen('{"a":1,"b":"2","c":null}')), { a: 1 });
  for (const raw of [null, '', 'not json', '[1,2]', '7']) assert.deepEqual(plain(read.parseSeen(raw)), {});
});
