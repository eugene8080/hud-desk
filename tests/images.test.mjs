import test from 'node:test';
import assert from 'node:assert/strict';
import { ditherLevels, glassImage, packLevels, thinEdges, IMAGE_WIDTH, IMAGE_HEIGHT } from '../bridge/image.mjs';
import { visibleClaudeMessage, visibleMessage } from '../bridge/conversation.mjs';
import { htmlImages, htmlToText } from '../bridge/mail-text.mjs';
import { messagePictures, messageWithPictures } from '../bridge/mail.mjs';
import { fetchPublicImage, privateAddress } from '../bridge/remote-image.mjs';

test('images dither grey to 16 panel levels, keep the mean tone and pack two pixels a byte', () => {
  const grey = new Uint8Array(IMAGE_WIDTH * IMAGE_HEIGHT).fill(136);
  assert.ok(ditherLevels(grey).every(level => level === 8), 'an exact level stays flat');
  const mid = ditherLevels(new Uint8Array(IMAGE_WIDTH * IMAGE_HEIGHT).fill(128));
  const average = mid.reduce((sum, level) => sum + level * 17, 0) / mid.length;
  assert.ok(Math.abs(average - 128) < 1, `mean tone kept (${average})`);
  assert.ok(new Set(mid).size === 2, 'a between-level grey dithers between its two neighbours');
  assert.equal(Buffer.from(packLevels(Uint8Array.from([15, 1, 0, 9])), 'base64').toString('hex'), 'f109');
  const image = glassImage(grey);
  assert.deepEqual([image.width, image.height, Math.round(image.mean * 255)], [576, 288, 136]);
  assert.throws(() => glassImage(new Uint8Array(10)));
});

test('transcripts count pasted images, keep image-only messages and ignore images in tool results', () => {
  const png = 'iVBORw0KGgo=';
  assert.deepEqual(visibleClaudeMessage({ type: 'user', uuid: 'u1', message: { role: 'user', content: [
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png } },
  ] } }), { role: 'user', text: '', id: 'u1', images: 1 });
  assert.equal(visibleClaudeMessage({ type: 'user', uuid: 'u2', message: { role: 'user', content: [
    { type: 'tool_result', content: [{ type: 'image', source: { type: 'base64', data: png } }] },
  ] } }), null);
  assert.deepEqual(visibleMessage({ type: 'response_item', payload: { type: 'message', role: 'user', id: 'c1', content: [
    { type: 'input_text', text: 'See' }, { type: 'input_image', image_url: `data:image/png;base64,${png}` },
  ] } }), { role: 'user', text: 'See', id: 'c1', images: 1 });
});

test('thin edges outline a filled square with a line one pixel wide', () => {
  const width = 40, height = 40, pixels = new Uint8Array(width * height);
  for (let y = 10; y < 30; y++) for (let x = 10; x < 30; x++) pixels[y * width + x] = 255;
  const edges = thinEdges({ width, height, pixels });
  // Across the left side (row 20), exactly one edge pixel; the inside and outside stay dark.
  const row = Array.from({ length: width }, (_, x) => edges[20 * width + x] > 0 ? 1 : 0);
  assert.equal(row.slice(0, 20).reduce((a, b) => a + b, 0), 1, row.join(''));
  assert.equal(edges[20 * width + 20], 0);
  // Every side of the square has edge pixels.
  for (const [x, y] of [[20, 9], [20, 30], [9, 20], [30, 20], [20, 10], [20, 29], [10, 20], [29, 20]]) void [x, y];
  assert.ok([9, 10].some(y => edges[y * width + 20] > 0) && [29, 30].some(y => edges[y * width + 20] > 0));
});

test('mail HTML: <img> tags are read in order, placed as markers, tracking pixels and icons dropped', () => {
  const html = '<p>Hi</p><img src="https://cdn.example.test/logo.png" alt="Morning &amp; Briefing" width="600">' +
    '<img src="https://t.example.test/open.gif" width="1" height="1"><img src="cid:chart1" alt="Chart">' +
    '<img src=\'https://cdn.example.test/icon.png\' style="width: 24px; height:24px"><img src="http://plain.example.test/a.png">';
  assert.deepEqual(htmlImages(html).map(i => [i.src, i.alt, i.width, i.height]), [
    ['https://cdn.example.test/logo.png', 'Morning & Briefing', 600, 0], ['https://t.example.test/open.gif', '', 1, 1],
    ['cid:chart1', 'Chart', 0, 0], ['https://cdn.example.test/icon.png', '', 24, 24], ['http://plain.example.test/a.png', '', 0, 0]]);
  assert.match(htmlToText(html), /Hi\n+\n\[\[img:0\]\]\n\n\[\[img:1\]\]/);
  const payload = { mimeType: 'multipart/related', parts: [
    { partId: '0', mimeType: 'text/html', body: { data: Buffer.from(html).toString('base64url') } },
    { partId: '1', mimeType: 'image/png', filename: 'chart.png', headers: [{ name: 'Content-ID', value: '<chart1>' }], body: { attachmentId: 'a', size: 9000 } },
  ] };
  const { text, images } = messagePictures(payload, 'Hi\n[[img:0]]\n[[img:1]]\n[[img:2]]\n[[img:3]]\n[[img:4]]');
  // The cid: image is the attached part (index 0); the linked logo is remote 0; pixel, icon and http are dropped.
  assert.deepEqual(images, [{ part: '1', name: 'chart.png' }, { remote: 0, name: 'Morning & Briefing' }]);
  assert.equal(text, 'Hi\n[[img:1]]\n\n[[img:0]]');
});

test('remote pictures: private, loopback, tailnet and link-local addresses are refused; only https on 443', async () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.10', '100.65.128.14', '169.254.1.1', '0.0.0.0',
    '::1', 'fd7a:115c:a1e0::1', 'fe80::1', '::ffff:192.168.1.1', '224.0.0.1']) assert.equal(privateAddress(address), true, address);
  for (const address of ['8.8.8.8', '151.101.1.69', '2606:4700::6810:84e5']) assert.equal(privateAddress(address), false, address);
  for (const url of ['http://cdn.example.test/a.png', 'https://cdn.example.test:8443/a.png', 'https://127.0.0.1/a.png',
    'https://user:pw@cdn.example.test/a.png', 'file:///C:/a.png', 'not a url']) {
    await assert.rejects(fetchPublicImage(url), { message: 'remote-refused' }, url);
  }
  // A name that resolves to a private address is refused inside the connection's lookup.
  const lookup = (host, options, callback) => callback(Object.assign(new Error('private address'), { code: 'EPRIVATE' }));
  await assert.rejects(fetchPublicImage('https://intranet.example.test/a.png', { lookup }), { message: 'remote-refused' });
});

test('mail with linked pictures is read from its HTML so they sit in place; ad and tracking servers are skipped', () => {
  const plain = 'A long plain version of the newsletter. '.repeat(10);
  const html = '<p>Top</p><img src="https://assets.example.test/banner.png" alt="Banner"><p>Story</p>' +
    '<img src="https://sli.example.test/imp?s=1"><img src="https://cdn.example.test/track/abc.gif"><img src="https://ad.doubleclick.net/x.png">';
  const payload = { mimeType: 'multipart/alternative', parts: [
    { partId: '0', mimeType: 'text/plain', body: { data: Buffer.from(plain).toString('base64url') } },
    { partId: '1', mimeType: 'text/html', body: { data: Buffer.from(html).toString('base64url') } },
  ] };
  const { text, images } = messageWithPictures(payload, 'Subject');
  assert.deepEqual(images, [{ remote: 0, name: 'Banner' }]);
  assert.match(text, /^Top\n+\[\[img:0\]\]\n+Story$/);
  // No placeable pictures: the plain part is read as before.
  const textOnly = { ...payload, parts: [payload.parts[0], { ...payload.parts[1], body: { data: Buffer.from('<p>Only text</p>').toString('base64url') } }] };
  assert.match(messageWithPictures(textOnly, 'Subject').text, /^A long plain version/);
});
