import test from 'node:test';
import assert from 'node:assert/strict';
import { bodyText, decodeEntities, parseFrom, unwrapPlain, withoutHistory } from '../bridge/mail-text.mjs';

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

// Synthetic newsletter text hard-wrapped at 72 columns, as many senders do.
const wrap = (text, width = 72) => {
  const lines = [];
  for (const paragraph of text.split('\n\n')) {
    let line = '';
    for (const word of paragraph.split(' ')) {
      if (line && line.length + 1 + word.length > width) { lines.push(line); line = word; }
      else line = line ? `${line} ${word}` : word;
    }
    lines.push(line, '');
  }
  return lines.join('\n').trimEnd();
};
const first = 'The quarterly synthetic report covers several invented markets, each one with ' +
  'its own fictional index, and every figure in this paragraph exists only for the test suite.';
const second = 'A second paragraph keeps going long enough to wrap onto more than one line at ' +
  'seventy-two columns, so the reflow has to join it as well without touching the first.';

test('hard-wrapped plain paragraphs are joined so the reader can use the full glasses width', () => {
  const source = wrap(`${first}\n\n${second}`);
  assert(source.split('\n').length > 5);
  assert.equal(unwrapPlain(source), `${first}\n\n${second}`);
  assert.equal(bodyText(part('text/plain', source)), `${first}\n\n${second}`);
});

test('reflow keeps list items, short lines, quotes and unwrapped bodies as they are', () => {
  const list = `${wrap(first)}\n- first synthetic item\n- second synthetic item\n1. numbered item`;
  assert.equal(unwrapPlain(list), `${first}\n- first synthetic item\n- second synthetic item\n1. numbered item`);
  const signature = `${wrap(second)}\n\nRegards,\nTest Sender\nExample Team`;
  assert.equal(unwrapPlain(signature), `${second}\n\nRegards,\nTest Sender\nExample Team`);
  const quoted = `${wrap(first)}\n> ${'quoted words '.repeat(5).trim()}\n> more quoted`;
  assert.match(unwrapPlain(quoted), /\n> quoted words.*\n> more quoted$/);
  const short = 'Line one\nLine two\nLine three';
  assert.equal(unwrapPlain(short), short);
  const long = `${first}\n${second}`;
  assert.equal(unwrapPlain(long), long);
});

test('format=flowed soft breaks join even when the body is not column-wrapped', () => {
  const flowed = 'Soft break here \ncontinues the sentence.\nHard break stays.';
  const lines = ['x'.repeat(70), 'y'.repeat(68), 'z'.repeat(66)].join('\n\n');
  assert.equal(unwrapPlain(`${flowed}\n\n${lines}`),
    `Soft break here continues the sentence.\nHard break stays.\n\n${lines}`);
});

test('replies are cut at Outlook headers, Original Message rules and wrote lines', () => {
  const outlook = 'New reply text.\n\n________________________________\nFrom: Test Sender <a@example.test>\nSent: Tuesday\nTo: Someone\nSubject: Earlier\n\nEarlier text.';
  assert.equal(withoutHistory(outlook), 'New reply text.');
  const bold = 'Reply.\n*From:* Test Sender\n*Sent:* Tuesday\nEarlier.';
  assert.equal(withoutHistory(bold), 'Reply.');
  assert.equal(withoutHistory('Reply.\n-----Original Message-----\nFrom: x\nOld.'), 'Reply.');
  assert.equal(withoutHistory('Reply.\n\nOn Tue, 3 Nov 2026 at 10:00, Test Sender\n<a@example.test> wrote:\nOld text.'), 'Reply.');
  assert.equal(withoutHistory('Reply.\nOn Tuesday Test wrote:\nOld.'), 'Reply.');
  // Not history: a From line with no Sent/Date line after it, and ordinary prose.
  const prose = 'From: the desk of the synthetic editor\nNothing else follows.\nShe wrote: a line.';
  assert.equal(withoutHistory(prose), prose);
});

test('forwards and history-only messages keep their text', () => {
  const forward = 'FYI\n---------- Forwarded message ---------\nFrom: Test <a@example.test>\nDate: Tue\nSubject: Report\n\nThe report.';
  assert.equal(withoutHistory(forward), forward);
  const outlookForward = 'See below.\nFrom: Test\nSent: Tue\n\nThe report.';
  assert.equal(withoutHistory(outlookForward, { subject: 'FW: Report' }), outlookForward);
  const onlyHistory = 'From: Test\nSent: Tue\nOld text.';
  assert.equal(withoutHistory(onlyHistory), onlyHistory);
  assert.equal(bodyText(part('text/plain', 'Answer.\r\nFrom: T\r\nSent: Tue\r\nOld.'), { subject: 'RE: Q' }), 'Answer.');
});
