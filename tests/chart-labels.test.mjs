// AI Labels (2026-11-27): the vision model's reading of a chart drawn back in place. Synthetic charts
// with fictional data only (scripts/make-chart-fixtures.py), and model answers recorded from the
// local model (qwen3.8:27b) on those charts. No test calls Ollama: the transport is a fake.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createImaging, modelQueue, parsePgm, screenView, layout, IMAGE_WIDTH, READ_PROMPT } from '../bridge/image.mjs';
import { LABELS_BOX_CALL, LABELS_CALL, LABELS_PROMPT_PLAIN, findWords, labelsView, matchTexts, modelTexts, tickRoles } from '../bridge/chart-labels.mjs';

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

test('AI Labels puts every horizontal line of three synthetic charts on its own printed words (boxes, and centre points)', () => {
  // model.json: a box per line (1.0.96); model-point.json: centre points, asked as the second turn
  // of the AI Readout conversation (1.0.98). Both recorded from the local model on these charts.
  for (const [name, kind] of CHARTS.flatMap(name => [[name, 'model.json'], [name, 'model-point.json']])) {
    const picture = source(name);
    const view = labelsView(picture, modelTexts(recorded(name, kind), picture.width, picture.height));
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
      assert.equal(near.length, 1, `${name} (${kind}): "${element.text}" anchored where it is printed (labels ${JSON.stringify(labels)})`);
    }
    // Nothing drawn that is not printed text of the chart.
    assert.ok(view.labels.every(l => truth(name).elements.some(e => e.text === l.text)), `${name} (${kind})`);
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
// A call with a schema gets the next of `answers`, any other call the readout text. hold() keeps
// every call in flight until the returned release() is called; an aborted call is marked.
function fakeModel(answers, readout = 'Title: Monthly Widget Orders, 2031') {
  const calls = [];
  let gate = null, open = 0, mostOpen = 0;
  const transport = async (url, init) => {
    const body = JSON.parse(init.body);
    if (url.endsWith('/api/show')) return new Response(JSON.stringify({ capabilities: ['completion', 'vision'] }));
    const call = { ...body, aborted: false };
    calls.push(call);
    mostOpen = Math.max(mostOpen, ++open);
    try {
      if (gate) await new Promise((resolve, reject) => {
        gate.then(resolve);
        init.signal.addEventListener('abort', () => { call.aborted = true; reject(new DOMException('stopped', 'AbortError')); });
      });
      const content = body.format ? JSON.stringify(answers.shift()) : readout;
      return new Response(JSON.stringify({ message: { content } }));
    } finally { open--; }
  };
  return { calls, transport, mostOpen: () => mostOpen,
    hold() { let release; gate = new Promise(r => { release = r; }); return () => { gate = null; release(); }; } };
}
const codec = { decode: bytes => parsePgm(gunzipSync(bytes)), forModel: bytes => Buffer.from(`png:${bytes.length}`) };
const chartBytes = name => readFileSync(fixture(name, 'pgm.gz'));
const settle = async imaging => { for (let i = 0; i < 400 && imaging.busy(); i++) await new Promise(r => setTimeout(r, 5)); };
const flushed = () => new Promise(r => setTimeout(r, 20));

test('imaging: AI Labels is the second turn of the AI Readout conversation, with centre points; each is read once per picture', async () => {
  const { calls, transport } = fakeModel([recorded('line-reference', 'model-point.json')]);
  const imaging = createImaging({ model: 'fixture-vision', transport, codec, prefetch: false });
  const load = async () => chartBytes('line-reference');
  const first = await imaging.render('mail:1', load, { view: 'labels' });
  assert.deepEqual([first.view, first.style, first.labels.length], ['labels', 'graphic', 23]);
  // The readout first (no schema), then the labels question in the same conversation.
  assert.equal(calls.length, 2);
  assert.deepEqual([calls[0].messages.length, calls[0].messages[0].content, calls[0].format], [1, READ_PROMPT, undefined]);
  assert.deepEqual(calls[1].messages.map(m => m.role), ['user', 'assistant', 'user']);
  assert.deepEqual(calls[1].messages[0], calls[0].messages[0], 'the same picture message, so Ollama reuses it');
  assert.equal(calls[1].messages[1].content, 'Title: Monthly Widget Orders, 2031');
  assert.equal(calls[1].messages[2].content, LABELS_CALL.prompt);
  assert.deepEqual(calls[1].format.properties.texts.items.required, ['text', 'role', 'point']);
  assert.ok(calls.every(c => c.options.temperature === 0));
  // Negative toggled, the same picture without a stable key (a Coding history picture), AI Readout:
  // no new model call.
  const light = await imaging.render('mail:1', load, { view: 'labels', negative: false });
  assert.deepEqual([light.negative, light.labels.length], [false, 23]);
  await imaging.render(null, load, { view: 'labels' });
  const read = await imaging.render(null, load, { view: 'read' });
  assert.equal(read.text, 'Title: Monthly Widget Orders, 2031');
  assert.equal(calls.length, 2);
});

test('imaging: opening a chart reads it in the background (readout, then labels); AI Readout and AI Labels then need no call', async () => {
  const { calls, transport } = fakeModel([recorded('bar-groups', 'model-point.json')]);
  const imaging = createImaging({ model: 'fixture-vision', transport, codec });
  const load = async () => chartBytes('bar-groups');
  const fit = await imaging.render('chat:1', load, { view: 'fit' });
  assert.equal(fit.style, 'graphic');
  await settle(imaging);
  assert.deepEqual(calls.map(c => Boolean(c.format)), [false, true]);
  await imaging.render('chat:1', load, { view: 'zoom' });
  assert.equal((await imaging.render('chat:1', load, { view: 'read' })).text, 'Title: Monthly Widget Orders, 2031');
  assert.equal((await imaging.render('chat:1', load, { view: 'labels' })).labels.length, 25);
  assert.equal(calls.length, 2);
  // A photo is not read in the background (its AI Readout is asked when opened).
  let seed = 3;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const width = 300, height = 200, pixels = Uint8Array.from({ length: width * height }, (_, i) => Math.round(255 * ((i % width) / width * 0.5 + random() * 0.5)));
  const photo = fakeModel([]);
  const photos = createImaging({ model: 'fixture-vision', transport: photo.transport, codec: { decode: () => ({ width, height, pixels }), forModel: () => Buffer.from('png') } });
  assert.equal((await photos.render('chat:2', async () => Buffer.from('x'), { view: 'fit' })).style, 'photo');
  await settle(photos);
  assert.equal(photo.calls.length, 0);
});

test('imaging: leaving a picture stops its background reading, one model call at a time; a view on screen is never stopped', async () => {
  const model = fakeModel([recorded('line-reference', 'model-point.json'), recorded('bar-groups', 'model-point.json')]);
  const imaging = createImaging({ model: 'fixture-vision', transport: model.transport, codec });
  const a = async () => chartBytes('line-reference'), b = async () => chartBytes('bar-groups'), c = async () => chartBytes('right-axis-dark');
  let release = model.hold();
  await imaging.render('a', a, { view: 'fit' });
  await flushed();
  assert.equal(model.calls.length, 1, "a's readout in flight");
  // Another picture opened: a's call is aborted, b's background reading starts.
  await imaging.render('b', b, { view: 'fit' });
  await flushed();
  assert.equal(model.calls[0].aborted, true);
  assert.equal(model.calls.length, 2);
  // The viewer closed: b's call is aborted too, and nothing else starts.
  imaging.idle();
  await flushed();
  assert.equal(model.calls[1].aborted, true);
  assert.equal(imaging.busy(), false);
  release();
  // Back on a: its readout is asked again (the stopped one was not kept).
  assert.equal((await imaging.render('a', a, { view: 'read' })).text, 'Title: Monthly Widget Orders, 2031');
  assert.equal(model.calls.length, 3);
  // A view on screen joins its background job; leaving the picture does not stop it then.
  release = model.hold();
  await imaging.render('c', c, { view: 'fit' });
  const reading = imaging.render('c', c, { view: 'read' });
  await flushed();
  imaging.idle();
  await flushed();
  assert.equal(model.calls.at(-1).aborted, false);
  release();
  assert.equal((await reading).text, 'Title: Monthly Widget Orders, 2031');
  await settle(imaging);
  assert.equal(model.mostOpen(), 1, 'never two model calls at once');
});

test('imaging: a chart reached in Zoom is read in the background too; a readout on screen queues the labels; photos keep their old scaling', async () => {
  const model = fakeModel([recorded('right-axis-dark', 'model-point.json')]);
  const scaled = [];
  const watching = { decode: codec.decode, forModel: (bytes, sharp) => { scaled.push(sharp); return codec.forModel(bytes); } };
  const imaging = createImaging({ model: 'fixture-vision', transport: model.transport, codec: watching });
  await imaging.render('z', async () => chartBytes('right-axis-dark'), { view: 'zoom', region: 1 });
  await settle(imaging);
  assert.deepEqual(model.calls.map(c => Boolean(c.format)), [false, true]);
  assert.deepEqual(scaled, [true], 'a chart goes to the model scaled with Lanczos');
  // A readout asked on screen first (an older app's order): the labels follow in the background.
  const second = fakeModel([recorded('line-reference', 'model-point.json')]);
  const readFirst = createImaging({ model: 'fixture-vision', transport: second.transport, codec });
  await readFirst.render('r', async () => chartBytes('line-reference'), { view: 'read' });
  await settle(readFirst);
  assert.deepEqual(second.calls.map(c => Boolean(c.format)), [false, true]);
  // A photo: AI Readout only, with ffmpeg's default scaling as before 2026-11-28.
  let seed = 11;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const width = 300, height = 200, pixels = Uint8Array.from({ length: width * height }, (_, i) => Math.round(255 * ((i % width) / width * 0.5 + random() * 0.5)));
  const photoScaled = [], photo = fakeModel([]);
  const photos = createImaging({ model: 'fixture-vision', transport: photo.transport,
    codec: { decode: () => ({ width, height, pixels }), forModel: (bytes, sharp) => { photoScaled.push(sharp); return Buffer.from('png'); } } });
  await photos.render('p', async () => Buffer.from('x'), { view: 'read' });
  await settle(photos);
  assert.deepEqual([photo.calls.length, photoScaled], [1, [false]]);
});

test('model queue: foreground before background; cancel stops only other pictures\' background jobs', async () => {
  const queue = modelQueue();
  const order = [];
  let release;
  const gate = new Promise(r => { release = r; });
  const first = queue.add(async () => { await gate; order.push('first'); }, { picture: 'p', background: true });
  const later = queue.add(async () => { order.push('background q'); }, { picture: 'q', background: true });
  const kept = queue.add(async () => { order.push('background p'); }, { picture: 'p', background: true });
  const shown = queue.add(async () => { order.push('foreground r'); }, { picture: 'r' });
  queue.cancel('p');
  await assert.rejects(later.promise, { message: 'cancelled' });
  release();
  await Promise.all([first.promise, kept.promise, shown.promise]);
  assert.deepEqual(order, ['first', 'foreground r', 'background p']);
  assert.equal(queue.idle, true);
});

test('imaging: the 1.0.96 box call: unusable boxes are asked once more in plain words; a photo answers as Original Picture', async () => {
  const { calls, transport } = fakeModel([recorded('line-reference', 'model-degenerate.json'), recorded('line-reference')]);
  const imaging = createImaging({ model: 'fixture-vision', transport, codec, prefetch: false, labelsCall: LABELS_BOX_CALL });
  const answer = await imaging.render('chat:1', async () => chartBytes('line-reference'), { view: 'labels' });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].messages[0].content, LABELS_PROMPT_PLAIN);
  assert.equal(answer.labels.length, 23);
  // Nothing usable twice: Original Picture, no labels.
  const twice = fakeModel([recorded('line-reference', 'model-degenerate.json'), recorded('line-reference', 'model-degenerate.json')]);
  const none = await createImaging({ model: 'fixture-vision', transport: twice.transport, codec, prefetch: false, labelsCall: LABELS_BOX_CALL })
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
