import test from 'node:test';
import assert from 'node:assert/strict';
import { bodyText, decodeEntities, parseFrom } from '../bridge/mail-text.mjs';

const part = (mimeType, text) => ({ mimeType, body: { data: Buffer.from(text).toString('base64url') } });
const multipart = (...parts) => ({ mimeType: 'multipart/mixed', parts });

test('Gmail MIME prefers plain text and decodes base64url with no padding', () => {
  const plain = 'Plain &amp; readable text. '.repeat(12) + ' 🧪 ࿿!';
  const message = part('text/plain', plain);
  assert.match(message.body.data, /[-_]/);
  assert(!message.body.data.includes('='));
  assert.equal(bodyText(multipart(message, part('text/html', '<p>Other copy</p>'))),
    plain.replaceAll('&amp;', '&').replaceAll(/ {2,}/g, ' '));
});

test('Gmail MIME renders HTML-only messages and falls back from short plain text in nested MIME', () => {
  const html = part('text/html',
    '<h1>Sample &amp; test</h1><p>A<br>B &nbsp;&#x1F9EA; &#169;</p><script>hidden</script>');
  const expected = 'Sample & test\nA\nB 🧪 ©';
  assert.equal(bodyText(html), expected);
  assert.equal(bodyText(multipart(
    { ...part('text/plain', 'attachment '.repeat(30)), filename: 'fixture.txt' },
    multipart(part('text/plain', 'See the HTML part'), html),
  )), expected);
  assert.equal(decodeEntities('&ldquo;Hi&rdquo; &trade; &constructor; &#x110000;'), '“Hi” ™ &constructor; ');
});

test('Gmail MIME strips quoted history, URLs and zero-width characters', () => {
  const padding = String.fromCodePoint(0x200b, 0x2028, 0x2029, 0xfeff, 0xad);
  const text = `He${padding}llo (https://example.test/a)\r\n\r\nOn Tuesday, A wrote:\r\n\r\n> prior\r\n>> before\r\n\r\nDone.`;
  assert.equal(bodyText(part('text/plain', text)), 'Hello\n\nDone.');
  assert.equal(bodyText(part('text/html',
    '<p>Hello</p><div>On Tuesday, A wrote:</div><blockquote>Previous mail</blockquote><p>Done.</p>',
  )), 'Hello\n\nDone.');
});

test('Gmail sender text prefers the display name and falls back to the address', () => {
  assert.equal(parseFrom('"Example, Test" <person@example.test>'), 'Example, Test');
  assert.equal(parseFrom('<person@example.test>'), 'person@example.test');
  assert.equal(parseFrom('person@example.test'), 'person@example.test');
});
