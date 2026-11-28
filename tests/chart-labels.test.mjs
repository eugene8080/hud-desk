// AI Labels (2026-11-27): the vision model's reading of a chart drawn back in place. Synthetic charts
// with fictional data only (scripts/make-chart-fixtures.py), and model answers recorded from the
// local model (qwen3.8:27b) on those charts. No test calls Ollama: the transport is a fake.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createImaging, parsePgm, screenView, layout, IMAGE_WIDTH } from '../bridge/image.mjs';
import { LABELS_PROMPT, LABELS_PROMPT_PLAIN, findWords, labelsView, matchTexts, modelTexts, tickRoles } from '../bridge/chart-labels.mjs';

const CHARTS = ['line-reference', 'bar-groups', 'right-axis-dark'];
const fixture = (name, kind) => new URL(`./fixtures/charts/${name}.${kind}`, import.meta.url);
const source = name => parsePgm(gunzipSync(readFileSync(fixture(name, 'pgm.gz'))));
const truth = name => JSON.parse(readFileSync(fixture(name, 'truth.json'), 'utf8'));
const recorded = (name, kind = 'model.json') => JSON.parse(readFileSync(fixture(name, kind), 'utf8')).answer;
const unpack = data => {
  const bytes = Buffer.from(data, 'base64');
  return Uint8Array.from({ length: bytes.length * 2 }, (_, i) => i & 1 ? bytes[i >> 1] & 15 : bytes[i >> 1] >> 4);
};
// Where a truth box lands on the screen (fit view, centred).
const onScreen = (picture, box) => {
  const { w, h } = layout(picture.width, picture.height, 'fit');
  const scale = w / picture.width, ox = (IMAGE_WIDTH - w) >> 1, oy = (288 - h) >> 1;
  return box.map((v, i) => v * scale + (i % 2 ? oy : ox));
};

test('AI Labels puts every horizontal line of three synthetic charts on its own printed words', () => {
  for (const name of CHARTS) {
    const picture = source(name);
    const view = labelsView(picture, modelTexts(recorded(name), picture.width, picture.height));
    for (const element of truth(name).elements) {
      const labels = view.labels.filter(l => l.text === element.text);
      if (element.vertical) {
        // Text on its side is left as printed: no label, its pixels kept.
        assert.equal(labels.length, 0, `${name}: ${element.text} (vertical)`);
        continue;
      }
      const [x0, y0, x1, y1] = onScreen(picture, element.box);
      // Measured 2026-11-27: anchors within 1.9 screen pixels; 2.5 allows for rounding.
      const near = labels.filter(l => {
        const x = l.align === 'left' ? x0 : l.align === 'right' ? x1 : (x0 + x1) / 2;
        return Math.abs(l.x - x) <= 2.5 && Math.abs(l.y - (y0 + y1) / 2) <= 2.5;
      });
      assert.equal(near.length, 1, `${name}: "${element.text}" anchored where it is printed (labels ${JSON.stringify(labels)})`);
    }
    // Nothing drawn that is not printed text of the chart.
    assert.ok(view.labels.every(l => truth(name).elements.some(e => e.text === l.text)), name);
  }
});

test('AI Labels roles: ticks the model called axis titles become ticks; ticks keep the centre, y ticks their shared edge', () => {
  const picture = source('line-reference');
  const view = labelsView(picture, modelTexts(recorded('line-reference'), picture.width, picture.height));
  const label = text => view.labels.find(l => l.text === text);
  assert.deepEqual([label('Jan').role, label('Jan').align], ['x-tick', 'center']);
  // Left axis values are printed right-aligned against the axis.
  assert.deepEqual([label('40').role, label('40').align], ['y-tick', 'right']);
  assert.equal(label('Monthly Widget Orders, 2031').align, 'left');
  // The dark chart's right axis: '$120' over '110' ... '80', also right-aligned.
  const dark = source('right-axis-dark');
  const darkView = labelsView(dark, modelTexts(recorded('right-axis-dark'), dark.width, dark.height));
  assert.deepEqual(['$120', '80'].map(t => darkView.labels.find(l => l.text === t).align), ['right', 'right']);
  // "Launch price" touches the series line, which takes its first letters: it keeps its right edge.
  assert.equal(darkView.labels.find(l => l.text === 'Launch price').align, 'right');
  // Roles from geometry alone.
  const row = ['A', 'B', 'C'].map((text, i) => ({ text, role: 'axis-title', box: [100 * i, 500, 100 * i + 20, 516] }));
  const column = ['10', '20', '30'].map((text, i) => ({ text, role: 'other', box: [900, 100 * i, 930, 100 * i + 16] }));
  const alone = { text: 'Mar. 2027', role: 'x-tick', box: [100, 540, 200, 556] };
  assert.deepEqual(tickRoles([...row, ...column, alone]), ['x-tick', 'x-tick', 'x-tick', 'y-tick', 'y-tick', 'y-tick', 'axis-title']);
});

test('AI Labels clears the replaced words and keeps lines, gridlines and swatches', () => {
  const picture = source('bar-groups');
  const texts = modelTexts(recorded('bar-groups'), picture.width, picture.height);
  const plain = unpack(screenView(picture, 'fit').data);
  const view = labelsView(picture, texts);
  const labelled = unpack(view.data);
  const { background } = view;
  // Every changed pixel lies inside (or 2px around) a replaced word, and became background.
  const boxes = truth('bar-groups').elements.filter(e => !e.vertical).map(e => onScreen(picture, e.box));
  let changed = 0;
  for (let i = 0; i < plain.length; i++) {
    if (plain[i] === labelled[i]) continue;
    changed++;
    const x = i % 576, y = Math.floor(i / 576);
    assert.equal(labelled[i], background);
    assert.ok(boxes.some(([x0, y0, x1, y1]) => x >= x0 - 2 && x <= x1 + 2 && y >= y0 - 2 && y <= y1 + 2), `pixel ${x},${y} outside every word`);
  }
  assert.ok(changed > 500, `words cleared (${changed} pixels)`);
  // The title's letters are gone; the legend swatches, bars and the vertical "Tonnes" are not.
  const [tx0, ty0, tx1, ty1] = onScreen(picture, truth('bar-groups').elements[0].box).map(Math.round);
  for (let y = ty0; y < ty1; y++) for (let x = tx0; x < tx1; x++) assert.equal(labelled[y * 576 + x], background, `title pixel ${x},${y}`);
  for (const box of [[30, 122, 52, 144], [150, 122, 172, 144], [36, 410, 60, 480]]) {
    const [x0, y0, x1, y1] = onScreen(picture, box).map(Math.round);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) assert.equal(labelled[y * 576 + x], plain[y * 576 + x], `kept ${x},${y}`);
  }
});

test('AI Labels draws nothing the model did not read or the picture does not show as text', () => {
  const picture = source('line-reference');
  const answer = recorded('line-reference');
  const made = { isChart: true, texts: [...answer.texts,
    // An invented value over the empty plot area, a whole-image box, a control character, a blank.
    { text: 'Profit 999', role: 'annotation', box: [700, 700, 800, 740] },
    { text: 'Orders', role: 'title', box: [0, 0, 1000, 1000] },
    { text: 'Jan\u0007', role: 'x-tick', box: [100, 860, 130, 890] },
    { text: '   ', role: 'other', box: [10, 10, 20, 20] }] };
  const texts = modelTexts(made, picture.width, picture.height);
  assert.equal(texts.unusable, 1, 'the whole-image box is counted as unusable');
  assert.ok(!texts.some(t => t.text.includes('\u0007') || !t.text.trim()));
  const view = labelsView(picture, texts);
  assert.ok(!view.labels.some(l => l.text === 'Profit 999' || l.text === 'Orders'));
  assert.equal(view.labels.length, truth('line-reference').elements.length);
  // A misreading that drops a letter (seen on a real chart: a doubled letter read once) is left out, and
  // its printed words keep their pixels; the correct lines around it are still drawn.
  const misread = { isChart: true, texts: answer.texts.map(t => t.text === 'Monthly Widget Orders, 2031' ? { ...t, text: 'Montly Widget Orders, 2031' }
    : t.text === 'Feb' ? { ...t, text: 'Fb' } : t) };
  const misreadView = labelsView(picture, modelTexts(misread, picture.width, picture.height));
  assert.ok(!misreadView.labels.some(l => /Montly|^Fb$/.test(l.text)));
  assert.equal(misreadView.labels.length, 21);
  const [tx0, ty0, tx1, ty1] = onScreen(picture, truth('line-reference').elements[0].box).map(Math.round);
  const plain = unpack(screenView(picture, 'fit').data), kept = unpack(misreadView.data);
  for (let y = ty0; y < ty1; y++) for (let x = tx0; x < tx1; x++) assert.equal(kept[y * 576 + x], plain[y * 576 + x]);
  // An answer whose boxes are all whole-image (seen with one prompt wording) gives nothing usable.
  const degenerate = modelTexts(recorded('line-reference', 'model-degenerate.json'), picture.width, picture.height);
  assert.equal(degenerate.length, 0);
  assert.equal(degenerate.unusable, 23);
  for (const broken of [null, 'text', {}, { texts: 'no' }, { texts: [{ text: 'A', box: [1, 2, 3] }] }]) assert.deepEqual([...modelTexts(broken, 100, 100)], []);
});

test('AI Labels with nothing read is Original Picture; negative off keeps a white chart white with dark labels', () => {
  const picture = source('line-reference');
  const empty = labelsView(picture, []);
  assert.equal(empty.data, screenView(picture, 'fit').data);
  assert.deepEqual(empty.labels, []);
  assert.deepEqual([empty.negative, empty.background, empty.ink], [true, 0, 15]);
  const texts = modelTexts(recorded('line-reference'), picture.width, picture.height);
  const light = labelsView(picture, texts, false);
  assert.deepEqual([light.negative, light.background, light.ink], [false, 15, 0]);
  assert.equal(light.labels.length, 23);
  // The dark chart is not inverted automatically.
  const dark = source('right-axis-dark');
  assert.deepEqual([labelsView(dark, []).negative, labelsView(dark, []).background], [false, 0]);
});

test('word finding: legend swatches and dashed lines are not words; the matcher keeps each word to one line', () => {
  const picture = source('bar-groups');
  const found = findWords(picture);
  // The 2030 legend word starts at its digits (x 60), not at the swatch (x 30).
  const legend = found.words.find(w => w.box[1] >= 118 && w.box[3] <= 148 && w.box[0] < 120);
  assert.ok(legend && legend.box[0] >= 58, JSON.stringify(legend?.box));
  const line = source('line-reference');
  const lineWords = findWords(line);
  // No word along the dashed target line (y 325) away from its "Target 50" label.
  assert.ok(!lineWords.words.some(w => w.box[1] <= 325 && w.box[3] >= 325 && w.box[0] > 300));
  const matches = matchTexts(modelTexts(recorded('line-reference'), line.width, line.height), lineWords);
  const used = matches.flatMap(m => m.parts);
  assert.equal(new Set(used).size, used.length);
});

// ---- The bridge's imaging object, with a fake model and a decoder instead of ffmpeg ----
function fakeModel(answers) {
  const calls = [];
  const transport = async (url, init) => {
    const body = JSON.parse(init.body);
    if (url.endsWith('/api/show')) return new Response(JSON.stringify({ capabilities: ['completion', 'vision'] }));
    calls.push(body);
    const content = body.format ? JSON.stringify(answers.shift()) : 'Title: Monthly Widget Orders, 2031';
    return new Response(JSON.stringify({ message: { content } }));
  };
  return { calls, transport };
}
const codec = { decode: bytes => parsePgm(gunzipSync(bytes)), forModel: bytes => Buffer.from(`png:${bytes.length}`) };
const chartBytes = name => readFileSync(fixture(name, 'pgm.gz'));

test('imaging: the labels view asks the model once per picture, with the JSON schema, and shares the queue with AI Readout', async () => {
  const { calls, transport } = fakeModel([recorded('line-reference')]);
  const imaging = createImaging({ model: 'fixture-vision', transport, codec });
  const load = async () => chartBytes('line-reference');
  const first = await imaging.render('mail:1', load, { view: 'labels' });
  assert.deepEqual([first.view, first.style, first.labels.length], ['labels', 'graphic', 23]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].messages[0].content, LABELS_PROMPT);
  assert.deepEqual(calls[0].format.required, ['isChart', 'texts']);
  assert.equal(calls[0].options.temperature, 0);
  // Negative toggled, and the same picture again without a stable key (a Coding history picture):
  // no new model call.
  const light = await imaging.render('mail:1', load, { view: 'labels', negative: false });
  assert.deepEqual([light.negative, light.labels.length], [false, 23]);
  await imaging.render(null, load, { view: 'labels' });
  assert.equal(calls.length, 1);
  // AI Readout is its own call, with today's prompt, and cached.
  const read = await imaging.render('mail:1', load, { view: 'read' });
  assert.equal(read.text, 'Title: Monthly Widget Orders, 2031');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].format, undefined);
});

test('imaging: unusable boxes are asked once more in plain words; a photo answers as Original Picture without the model', async () => {
  const { calls, transport } = fakeModel([recorded('line-reference', 'model-degenerate.json'), recorded('line-reference')]);
  const imaging = createImaging({ model: 'fixture-vision', transport, codec });
  const answer = await imaging.render('chat:1', async () => chartBytes('line-reference'), { view: 'labels' });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].messages[0].content, LABELS_PROMPT_PLAIN);
  assert.equal(answer.labels.length, 23);
  // Nothing usable twice: Original Picture, no labels.
  const twice = fakeModel([recorded('line-reference', 'model-degenerate.json'), recorded('line-reference', 'model-degenerate.json')]);
  const none = await createImaging({ model: 'fixture-vision', transport: twice.transport, codec })
    .render('chat:2', async () => chartBytes('line-reference'), { view: 'labels' });
  assert.deepEqual(none.labels, []);
  assert.equal(none.data, screenView(source('line-reference'), 'fit').data);
  // A photo (smooth random tones, no three dominant greys): Original Picture, no model call.
  let seed = 7;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const width = 300, height = 200, pixels = Uint8Array.from({ length: width * height }, (_, i) => Math.round(255 * ((i % width) / width * 0.5 + random() * 0.5)));
  const photo = fakeModel([]);
  const photoCodec = { decode: () => ({ width, height, pixels }), forModel: () => Buffer.from('png') };
  const shown = await createImaging({ model: 'fixture-vision', transport: photo.transport, codec: photoCodec }).render('chat:3', async () => Buffer.from('x'), { view: 'labels' });
  assert.deepEqual([shown.view, shown.style, shown.labels], ['fit', 'photo', undefined]);
  assert.equal(photo.calls.length, 0);
  // No vision model: AI Labels is unavailable, as AI Readout is.
  const blind = createImaging({ transport: fakeModel([]).transport, codec });
  await assert.rejects(blind.render('chat:4', async () => chartBytes('bar-groups'), { view: 'labels' }), { message: 'read-unavailable' });
});
