import test from 'node:test';
import assert from 'node:assert/strict';
import { ditherLevels, glassImage, packLevels, IMAGE_WIDTH, IMAGE_HEIGHT } from '../bridge/image.mjs';
import { visibleClaudeMessage, visibleMessage } from '../bridge/conversation.mjs';

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
