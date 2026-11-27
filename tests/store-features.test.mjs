// Drift guard for the Even Hub paste texts: store/features.md is the source Eugene opens,
// store/description.txt is the same description kept as the exact portal text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const block = (text, name) => {
  const match = text.match(new RegExp(`<!-- ${name}:start -->\\n([^]*?)\\n<!-- ${name}:end -->`));
  assert(match, `features.md has a ${name} block`);
  return match[1];
};
// The portal counts characters, not UTF-16 units; spread counts code points.
const length = text => [...text].length;

test('store description block matches store/description.txt and fits the portal limit', () => {
  const features = read('store/features.md');
  const description = block(features, 'description');
  assert.equal(read('store/description.txt').trimEnd(), description.trimEnd());
  assert(length(description) <= 2000, `description is ${length(description)} characters`);
});

test('the Japanese store description fits the portal limit and keeps the source links', () => {
  const ja = read('store/description.ja.txt');
  assert(length(ja.trimEnd()) <= 2000, `Japanese description is ${length(ja.trimEnd())} characters`);
  for (const line of read('store/description.txt').split('\n').filter(line => /^(?:Source\/setup|Original): /.test(line))) {
    assert(ja.includes(line), `Japanese description keeps "${line}"`);
  }
});

test('what is new block fits the beta changelog limit and names the current version', () => {
  const features = read('store/features.md');
  const whatsNew = block(features, 'whatsnew');
  assert(length(whatsNew) >= 1 && length(whatsNew) <= 500, `what's new is ${length(whatsNew)} characters`);
  const { version } = JSON.parse(read('app/app.json'));
  assert(whatsNew.startsWith(`${version}:`), `what's new starts with the app.json version ${version}`);
  assert.match(features, new RegExp(`Current beta: \\*\\*${version.replaceAll('.', '\\.')}\\*\\*`));
});
