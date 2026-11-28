// Images for the glasses (Eugene, 2026-11-27: Chat photos, Email images, Coding screenshots).
// ffmpeg decodes the picture once (stdin only, image demuxers only, one frame, size and time limits)
// to 8-bit grey at up to 2400 px; the views are computed here from that copy:
// - fit:     the whole picture inside 576x288 in the G2 picture style below.
// G2 picture style (Eugene on G2 with 1.0.83: "the actual pictures are all bad"; the G2oom port's
// pipeline, r/EvenRealities 2026): contrast stretch, gamma 0.45 to lift mid-tones, Sobel edges at
// full brightness, every other pixel at 60 % through a 4x4 Bayer matrix to on/off. Smooth greys and
// error-diffused noise blur on the waveguide; bright outlines and a stable dot pattern stay crisp.
// A mostly white picture (a light-mode screenshot) is made negative first, so its edges stay lit.
// - zoom:    at least twice the fit size (a tall screenshot fills the width), read in 576x288
//            sections in reading order; `region` picks the section, `regions` says how many.
// - read:    the local vision model (Ollama) reads the picture as text: chart values, screen text,
//            or two or three lines on a photo (Eugene: "AI even?"; a KPI chart read correctly in 20 s).
// - labels:  Original Picture with the model's reading of each printed line drawn back in place by
//            the app (AI Labels, bridge/chart-labels.mjs). Any picture since 2026-11-28 (charts only
//            before); a photo in which the model finds no text answers as fit.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { executable } from './platform.mjs';
import { LABELS_CALL, labelsView, modelTexts } from './chart-labels.mjs';

export const IMAGE_WIDTH = 576, IMAGE_HEIGHT = 288;
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
export const VIEWS = new Set(['fit', 'labels', 'zoom', 'read']);
// Outline (edges only) was removed on 2026-11-28 (Eugene). Apps before 1.0.97 still offer it, so
// their request gets Original Picture instead of an error.
const RETIRED_VIEWS = { outline: 'fit' };
const MAX_SIDE = 2400;
const FORMATS = 'png_pipe,jpeg_pipe,webp_pipe,gif,bmp_pipe,tiff_pipe,image2pipe,mov';
const DECODE_FILTER = `scale='min(${MAX_SIDE},iw)':'min(${MAX_SIDE},ih)':force_original_aspect_ratio=decrease,format=gray`;
const OLLAMA = 'http://127.0.0.1:11434';
export const READ_PROMPT = [
  'You describe a picture for a person reading it on smart glasses with a tiny monochrome text screen.',
  'Write plain text, at most 12 short lines, no Markdown.',
  'If it is a chart or table: give the title, then one line per series or row with its numbers (value, target, range).',
  'If it is a screenshot of an app or document: transcribe the visible text in reading order.',
  'If it is a photo: say what it shows in 2-3 lines, then any readable text.',
].join(' ');

export class ImageError extends Error {
  constructor(code, status) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

// Grey bytes (0..255) -> panel levels (0..15), error diffused so mid-greys keep their tone.
export function ditherLevels(grey, width = IMAGE_WIDTH, height = IMAGE_HEIGHT) {
  const work = Float32Array.from(grey);
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const value = Math.max(0, Math.min(255, work[i]));
      const level = Math.round(value / 17);
      out[i] = level;
      const error = value - level * 17;
      if (x + 1 < width) work[i + 1] += error * 7 / 16;
      if (y + 1 < height) {
        if (x > 0) work[i + width - 1] += error * 3 / 16;
        work[i + width] += error * 5 / 16;
        if (x + 1 < width) work[i + width + 1] += error / 16;
      }
    }
  }
  return out;
}

// Two levels a byte, high nibble first, base64 for the JSON answer (82,944 bytes raw).
export function packLevels(levels) {
  const packed = Buffer.alloc(Math.ceil(levels.length / 2));
  for (let i = 0; i < levels.length; i += 2) packed[i >> 1] = (levels[i] << 4) | (levels[i + 1] ?? 0);
  return packed.toString('base64');
}

const mean = grey => { let sum = 0; for (const v of grey) sum += v; return grey.length ? sum / grey.length / 255 : 0; };

// The answer for a 576x288 grey screen: packed dithered levels and the mean brightness (0..1),
// which the app uses to show a mostly white picture in negative by default.
export function glassImage(grey) {
  if (grey.length !== IMAGE_WIDTH * IMAGE_HEIGHT) throw new ImageError('image-failed', 502);
  return { width: IMAGE_WIDTH, height: IMAGE_HEIGHT, data: packLevels(ditherLevels(grey)), mean: mean(grey) };
}

// PGM (P5) from ffmpeg: "P5\n<w> <h>\n255\n" then w*h bytes.
export function parsePgm(buffer) {
  const header = /^P5\s+(\d+)\s+(\d+)\s+(\d+)\s/.exec(buffer.subarray(0, 64).toString('latin1'));
  if (!header || header[3] !== '255') throw new ImageError('image-failed', 502);
  const width = Number(header[1]), height = Number(header[2]);
  const pixels = buffer.subarray(header[0].length, header[0].length + width * height);
  if (!width || !height || pixels.length !== width * height) throw new ImageError('image-failed', 502);
  return { width, height, pixels };
}

// Area-average resample (bilinear-free box filter; nearest when enlarging).
export function resample({ width, height, pixels }, toWidth, toHeight) {
  const out = new Uint8Array(toWidth * toHeight);
  const sx = width / toWidth, sy = height / toHeight;
  for (let y = 0; y < toHeight; y++) {
    const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.min(height, Math.floor((y + 1) * sy)));
    for (let x = 0; x < toWidth; x++) {
      const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.min(width, Math.floor((x + 1) * sx)));
      let sum = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) sum += pixels[yy * width + xx];
      out[y * toWidth + x] = Math.round(sum / ((y1 - y0) * (x1 - x0)));
    }
  }
  return { width: toWidth, height: toHeight, pixels: out };
}

// Stretch the 1st..99th percentile to the full range, so a grey chart uses every panel level.
export function stretch(pixels) {
  const counts = new Uint32Array(256);
  for (const v of pixels) counts[v]++;
  const cut = pixels.length / 100;
  let low = 0, high = 255, seen = 0;
  while (low < 255 && (seen += counts[low]) < cut) low++;
  seen = 0;
  while (high > 0 && (seen += counts[high]) < cut) high--;
  if (high - low < 16) return pixels;
  const out = new Uint8Array(pixels.length);
  for (let i = 0; i < pixels.length; i++) out[i] = Math.max(0, Math.min(255, Math.round((pixels[i] - low) * 255 / (high - low))));
  return out;
}

// Thin edges (Eugene on G2, 2026-11-27: "the outline lines are too thick"). Sobel marks every pixel
// on an edge's slope, 2-3 px wide; as in the Canny detector, only the pixel that is strongest across
// the edge (along the gradient) is kept, so lines are 1 px. Hysteresis: a pixel above `high` of the
// strongest edges starts a line, and pixels above `low` join it only when connected to one, so
// lines stay continuous without speckle. Returns strength 0..1 per pixel (0 = no edge).
export function thinEdges({ width, height, pixels }, high = 0.3, low = 0.12) {
  const n = width * height;
  const magnitude = new Float32Array(n), angle = new Uint8Array(n);
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const p = (dx, dy) => pixels[(y + dy) * width + x + dx];
    const gx = p(1, -1) + 2 * p(1, 0) + p(1, 1) - p(-1, -1) - 2 * p(-1, 0) - p(-1, 1);
    const gy = p(-1, 1) + 2 * p(0, 1) + p(1, 1) - p(-1, -1) - 2 * p(0, -1) - p(1, -1);
    const i = y * width + x;
    magnitude[i] = Math.hypot(gx, gy);
    // Gradient direction in four sectors: 0 = horizontal, 1 = 45 deg, 2 = vertical, 3 = 135 deg.
    const a = (Math.atan2(gy, gx) * 180 / Math.PI + 180) % 180;
    angle[i] = a < 22.5 || a >= 157.5 ? 0 : a < 67.5 ? 1 : a < 112.5 ? 2 : 3;
  }
  const step = [[1, 0], [1, 1], [0, 1], [-1, 1]];
  const kept = new Float32Array(n);
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const i = y * width + x, m = magnitude[i];
    if (!m) continue;
    const [dx, dy] = step[angle[i]];
    if (m >= magnitude[i + dy * width + dx] && m > magnitude[i - dy * width - dx]) kept[i] = m;
  }
  const nonzero = kept.filter(v => v > 0).sort();
  const top = nonzero[Math.floor(nonzero.length * 0.98)] || 1;
  const out = new Float32Array(n);
  const stack = [];
  for (let i = 0; i < n; i++) if (kept[i] / top >= high) { out[i] = Math.min(1, kept[i] / top); stack.push(i); }
  while (stack.length) {
    const i = stack.pop(), x = i % width, y = (i - x) / width;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const j = ny * width + nx;
      if (!out[j] && kept[j] / top >= low) { out[j] = Math.min(1, kept[j] / top); stack.push(j); }
    }
  }
  return out;
}

const BAYER4 = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
// The G2 picture style for a scaled grey picture (levels 0..15, edges 15, dots 15).
export function g2Picture(picture) {
  const { width, height } = picture;
  const lifted = new Uint8Array(picture.pixels.length);
  const tone = stretch(picture.pixels);
  for (let i = 0; i < tone.length; i++) lifted[i] = Math.round(255 * Math.pow(tone[i] / 255, 0.45));
  const edges = thinEdges({ width, height, pixels: lifted });
  const levels = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    if (edges[i] > 0) { levels[i] = 15; continue; }
    // Absolute screen position for the matrix keeps the pattern still between sections.
    // Dark areas stay black (no dots below 30 %), so a dark background is not a field of dots.
    const fill = Math.max(0, (lifted[i] / 255 - 0.3) / 0.7) * 0.6;
    levels[i] = fill * 16 > BAYER4[y & 3][x & 3] + 0.5 ? 15 : 0;
  }
  return levels;
}

// Charts, screenshots and documents are a few flat tones; photos spread over the whole range. On a
// 16-bin histogram, a graphic puts most of its pixels in its three largest bins. (G2oom edges make
// hollow, double-stroked letters, so text-heavy pictures must not get them.)
export function pictureStyle(pixels) {
  const bins = new Uint32Array(16);
  for (const v of pixels) bins[v >> 4]++;
  const top = [...bins].sort((a, b) => b - a);
  return (top[0] + top[1] + top[2]) / Math.max(1, pixels.length) > 0.7 ? 'graphic' : 'photo';
}

// A graphic: contrast stretched, then four flat levels (0, 5, 10, 15), no dithering, so letters stay
// solid and flat areas stay even on the waveguide.
export function flatLevels(pixels) {
  const tone = stretch(pixels);
  const levels = new Uint8Array(tone.length);
  for (let i = 0; i < tone.length; i++) levels[i] = Math.min(3, Math.round(tone[i] / 85)) * 5;
  return levels;
}

// Where a picture of width x height lands on the screen for a view: the scaled size, the number of
// sections and the top-left corner of section `region` (reading order, sections spread evenly so
// the last one ends at the picture's edge).
export function layout(width, height, view, region = 0) {
  const fit = Math.min(IMAGE_WIDTH / width, IMAGE_HEIGHT / height);
  const scale = view === 'zoom' ? Math.min(Math.max(IMAGE_WIDTH / width, IMAGE_HEIGHT / height, 2 * fit), Math.max(2, 2 * fit)) : fit;
  const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
  const cols = Math.max(1, Math.ceil(w / IMAGE_WIDTH)), rows = Math.max(1, Math.ceil(h / IMAGE_HEIGHT));
  const regions = view === 'zoom' ? cols * rows : 1;
  const r = Math.max(0, Math.min(regions - 1, region));
  const col = r % cols, row = Math.floor(r / cols);
  const x = cols > 1 ? Math.round(col * (w - IMAGE_WIDTH) / (cols - 1)) : 0;
  const y = rows > 1 ? Math.round(row * (h - IMAGE_HEIGHT) / (rows - 1)) : 0;
  return { w, h, regions, region: r, x, y };
}

// One 576x288 screen of a decoded picture for a view (fit or zoom). negative: true or
// false as asked, undefined = automatic (mostly white pictures).
export function screenView(source, view = 'fit', region = 0, negative) {
  const { w, h, regions, region: r, x, y } = layout(source.width, source.height, view, region);
  const resampled = resample(source, w, h);
  const brightness = mean(resampled.pixels);
  const inverted = negative ?? brightness > 0.6;
  const scaled = inverted ? { ...resampled, pixels: resampled.pixels.map(v => 255 - v) } : resampled;
  const screen = new Uint8Array(IMAGE_WIDTH * IMAGE_HEIGHT);
  // Centre a smaller picture; crop a section of a larger one.
  const ox = w < IMAGE_WIDTH ? (IMAGE_WIDTH - w) >> 1 : -x, oy = h < IMAGE_HEIGHT ? (IMAGE_HEIGHT - h) >> 1 : -y;
  // Both work on the picture alone, so the edge between the picture and the black padding does not
  // become a line.
  const style = pictureStyle(scaled.pixels);
  const tone = style === 'graphic' ? flatLevels(scaled.pixels) : g2Picture(scaled);
  for (let yy = 0; yy < h; yy++) {
    const sy = yy + oy;
    if (sy < 0 || sy >= IMAGE_HEIGHT) continue;
    for (let xx = 0; xx < w; xx++) {
      const sx = xx + ox;
      if (sx >= 0 && sx < IMAGE_WIDTH) screen[sy * IMAGE_WIDTH + sx] = tone[yy * w + xx];
    }
  }
  return { width: IMAGE_WIDTH, height: IMAGE_HEIGHT, data: packLevels(screen), mean: brightness, negative: inverted, style, view, regions, region: r };
}

function run(ffmpeg, args, bytes, limit) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'], signal: AbortSignal.timeout(20000) });
    const chunks = [];
    let size = 0;
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > limit) child.kill();
      else chunks.push(chunk);
    });
    child.on('error', () => reject(new ImageError('image-failed', 502)));
    // A decoder that stops reading early closes stdin; that is not an error here.
    child.stdin.on('error', () => {});
    child.on('close', code => code === 0 && size <= limit ? resolve(Buffer.concat(chunks)) : reject(new ImageError('image-failed', 502)));
    child.stdin.end(bytes);
  });
}
const INPUT = ['-loglevel', 'error', '-protocol_whitelist', 'pipe', '-format_whitelist', FORMATS, '-i', 'pipe:0', '-frames:v', '1'];
const decode = (ffmpeg, bytes) => run(ffmpeg, [...INPUT, '-vf', DECODE_FILTER, '-f', 'image2pipe', '-c:v', 'pgm', 'pipe:1'], bytes, MAX_SIDE * MAX_SIDE + 64)
  .then(parsePgm);
// A PNG goes to the model as it is; anything else (JPEG, WebP, HEIC, GIF) goes as a PNG of at most
// 1600 px. JPEG is converted too: Ollama's loader refused a progressive JPEG with 400 'Failed to load
// image or audio file' (2026-11-27, a product photo from a chat).
// sharp: Lanczos scaling, for AI Labels. With ffmpeg's default (bicubic) a real chart's title came
// back with a doubled letter read once; with Lanczos (and with the full-size picture) it was read
// right, in the same number of prompt tokens (2026-11-27). AI Readout keeps the default.
const forModel = (ffmpeg, bytes, sharp = false) => /^\x89PNG/.test(bytes.subarray(0, 4).toString('latin1')) ? Promise.resolve(bytes)
  : run(ffmpeg, [...INPUT, '-vf', `scale='min(1600,iw)':'min(1600,ih)':force_original_aspect_ratio=decrease${sharp ? ':flags=lanczos' : ''}`,
    '-f', 'image2pipe', '-c:v', 'png', 'pipe:1'], bytes, MAX_IMAGE_BYTES);

// ---- The local vision model (2026-11-28) ----
// One model call at a time: the GPU runs one model, and a second call would only wait inside Ollama.
// Calls for the view on screen (foreground) go before prefetch calls (background, for the chart just
// opened). Leaving a picture (another picture asked for, or the viewer closed) stops its background
// calls: the one in flight is aborted (Ollama stops generating when the request closes) and the
// waiting ones are dropped. A foreground caller that wants a background job's answer joins it and
// it is no longer stopped.
export function modelQueue() {
  const waiting = [];
  let running = null;
  const pump = () => {
    if (running || !waiting.length) return;
    const at = waiting.findIndex(job => !job.background);
    const job = waiting.splice(at >= 0 ? at : 0, 1)[0];
    const controller = new AbortController();
    running = { job, controller };
    Promise.resolve().then(() => job.run(controller.signal)).then(job.resolve, job.reject)
      .finally(() => { running = null; pump(); });
  };
  return {
    // run(signal) -> Promise; picture: the picture's id; background: a prefetch.
    add(run, { picture, background = false } = {}) {
      const job = { run, picture, background };
      job.promise = new Promise((resolve, reject) => Object.assign(job, { resolve, reject }));
      waiting.push(job);
      pump();
      return job;
    },
    promote(job) { job.background = false; },
    // Stop the background work of every picture but `keep` (all of it without `keep`).
    cancel(keep) {
      for (let i = waiting.length - 1; i >= 0; i--) {
        const job = waiting[i];
        if (job.background && job.picture !== keep) { waiting.splice(i, 1); job.reject(new ImageError('cancelled', 409)); }
      }
      if (running?.job.background && running.job.picture !== keep) running.controller.abort();
    },
    get idle() { return !running && !waiting.length; },
  };
}

// ffmpeg from PATH, else the configured path; `model` the Ollama vision model for the Read and
// AI Labels views. `codec` replaces ffmpeg in tests: { decode(bytes) -> {width, height, pixels},
// forModel(bytes, sharp) -> PNG bytes }. `prefetch` (default on): opening a chart in Original Picture
// starts its AI Readout and then its AI Labels reading in the background. `labelsCall` replaces
// LABELS_CALL (tests and measurements).
export function createImaging({ ffmpeg, model, transport = fetch, codec, prefetch = true, labelsCall = LABELS_CALL } = {}) {
  const LABELS = labelsCall;
  const path = () => codec ? 'codec' : executable('ffmpeg') || (ffmpeg && existsSync(ffmpeg) ? ffmpeg : undefined);
  const decodeWith = (tool, bytes) => codec ? Promise.resolve(codec.decode(bytes)) : decode(tool, bytes);
  const pngFor = (tool, bytes, sharp) => codec ? Promise.resolve(codec.forModel(bytes, sharp)) : forModel(tool, bytes, sharp);
  const sources = new Map();
  let decoding = Promise.resolve();
  const queue = modelQueue();
  let vision; // { at, ok }: the model's vision capability, checked at most once a minute
  const remember = (map, key, value, limit) => {
    map.delete(key);
    map.set(key, value);
    if (map.size > limit) map.delete(map.keys().next().value);
  };
  async function source(key, load) {
    if (key !== null && sources.has(key)) {
      const hit = sources.get(key);
      remember(sources, key, hit, 6);
      return hit;
    }
    const ffmpeg = path();
    if (!ffmpeg) throw new ImageError('images-unavailable', 503);
    const bytes = await load();
    if (!bytes?.length || bytes.length > MAX_IMAGE_BYTES) throw new ImageError('image-failed', 502);
    // One decode at a time: a page of photos must not start a dozen ffmpeg processes.
    const pending = decoding.then(() => decodeWith(ffmpeg, bytes));
    decoding = pending.catch(() => {});
    // The picture's id for the model's readings: its content, so a history picture (no stable key)
    // is read once too.
    const value = { ...(await pending), bytes, hash: createHash('sha256').update(bytes).digest('hex') };
    if (key !== null) remember(sources, key, value, 6);
    return value;
  }
  async function readable() {
    if (!model) return false;
    if (vision && Date.now() - vision.at < 60000) return vision.ok;
    let ok = false;
    try {
      const res = await transport(`${OLLAMA}/api/show`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model }), signal: AbortSignal.timeout(3000) });
      ok = res.ok && (await res.json()).capabilities?.includes('vision') === true;
    } catch { /* Ollama not running. */ }
    vision = { at: Date.now(), ok };
    return ok;
  }
  // One chat call; the answer's text ('' when the model gave none). Stopped by `signal` (prefetch
  // left behind) or after 180 s.
  async function chat(messages, signal, format) {
    const res = await transport(`${OLLAMA}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, stream: false, think: false, ...(format && { format }), options: { temperature: 0 }, messages }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(180000)]) });
    return res.ok ? String((await res.json()).message?.content ?? '').trim() : '';
  }
  // Whether Original Picture draws it in flat tones (a chart, a screenshot); once per picture.
  const isChart = picture => {
    if (picture.chart === undefined) {
      const { w, h } = layout(picture.width, picture.height, 'fit');
      picture.chart = pictureStyle(resample(picture, w, h).pixels) === 'graphic';
    }
    return picture.chart;
  };
  // Readings per picture (by content): the PNG the model sees, and the readout and chart texts as
  // queue jobs, in flight or done. 24 pictures kept. A chart goes to the model scaled with Lanczos
  // (both turns of its conversation send the same picture); a photo as before (bicubic).
  const readings = new Map();
  function readingOf(picture) {
    const entry = readings.get(picture.hash) ?? { hash: picture.hash };
    remember(readings, picture.hash, entry, 24);
    if (!entry.image) {
      entry.image = pngFor(path(), picture.bytes, isChart(picture)).then(png => png.toString('base64'));
      entry.image.catch(() => { delete entry.image; });
    }
    return entry;
  }
  // The job behind `field`, started if needed; a foreground caller promotes a background job. A job
  // that fails or is stopped is forgotten, so the next request starts it again.
  function joined(entry, field, run, background) {
    let job = entry[field];
    if (!job) {
      job = queue.add(run, { picture: entry.hash, background });
      entry[field] = job;
      job.promise.catch(() => { if (entry[field] === job) delete entry[field]; });
    } else if (!background) queue.promote(job);
    return job.promise;
  }
  // AI Readout: the picture's text for the glasses.
  function readout(picture, background = false) {
    const entry = readingOf(picture);
    return joined(entry, 'readout', async signal => {
      const image = await entry.image;
      const text = await chat([{ role: 'user', content: READ_PROMPT, images: [image] }], signal);
      if (!text) throw new ImageError('read-failed', 502);
      return text.slice(0, 4000);
    }, background);
  }
  // AI Labels: the chart's printed lines as the model reads them, in source pixels. LABELS_CALL
  // decides how; `readoutText` is the conversation's first answer when it is a conversation. When
  // more than a third of an answer's positions are unusable, the plain wording is asked once more.
  // Nothing usable: an empty list (the app keeps Original Picture).
  function chartTexts(picture, background, readoutText) {
    const entry = readingOf(picture);
    return joined(entry, 'texts', async signal => {
      const image = await entry.image;
      const ask = async prompt => {
        const messages = LABELS.conversation
          // The readout's conversation, the labels question as its second turn: Ollama reuses the
          // processed picture (measured 2026-11-28, docs/pictures.md).
          ? [{ role: 'user', content: READ_PROMPT, images: [image] }, { role: 'assistant', content: readoutText },
            { role: 'user', content: prompt }]
          : [{ role: 'user', content: prompt, images: [image] }];
        const text = await chat(messages, signal, LABELS.schema);
        try { return JSON.parse(text); } catch { return null; }
      };
      let texts = modelTexts(await ask(LABELS.prompt), picture.width, picture.height);
      if (texts.unusable > (texts.length + texts.unusable) / 3) {
        const again = modelTexts(await ask(LABELS.plain), picture.width, picture.height);
        if (again.length > texts.length) texts = again;
      }
      // How many printed lines the model found: every later answer for this picture carries it, so
      // the app drops AI Labels for a picture with none (a photo without text).
      entry.labelCount = texts.length;
      return texts;
    }, background).catch(error => { throw error instanceof ImageError ? error : new ImageError('read-failed', 502); });
  }
  // In a conversation, the labels call needs the readout first (a quick call).
  async function labelTexts(picture, background = false) {
    return chartTexts(picture, background, LABELS.conversation ? await readout(picture, background) : undefined);
  }
  // Prefetch for a picture just opened: its readout, then its labels, in the background. Errors and
  // stops are quiet: the foreground request asks again.
  let prefetching = 0; // prefetches under way, from the model check to the last answer
  async function prefetchFor(picture) {
    prefetching++;
    try {
      if (!await readable()) return;
      await readout(picture, true);
      await labelTexts(picture, true);
    } catch { /* Stopped (picture left) or failed: asked again when the view is opened. */ }
    finally { prefetching--; }
  }
  return {
    available: () => Boolean(path()),
    readable,
    // The app left the picture viewer: stop the background readings.
    idle: () => queue.cancel(),
    // Whether a model call is running or waiting (measurements, tests).
    busy: () => prefetching > 0 || !queue.idle,
    // key: a stable id for the source (chat message, mail part) or null (not cached).
    async render(key, load, { view: asked = 'fit', region = 0, negative } = {}) {
      const view = RETIRED_VIEWS[asked] ?? asked;
      if (!VIEWS.has(view) || !Number.isSafeInteger(region) || region < 0 || region > 99) throw new ImageError('bad request', 400);
      const picture = await source(key, load);
      // Any request for this picture means the others were left.
      queue.cancel(picture.hash);
      // Every picture on screen in any view is read in the background (a swipe in Zoom opens the next
      // picture in Zoom); after its readout on screen, its labels are read next. Until 2026-11-28 only
      // charts were (pictureStyle 'graphic'), and only charts had AI Labels: an infographic on a smooth
      // grey gradient (a newsletter in Eugene's mail: 65 % of pixels in the three main greys, the cut is
      // 70 %) counted as a photo and got none. Whether a picture has text is now the model's reading.
      const ahead = () => { if (prefetch && model) void prefetchFor(picture); };
      // Lines found, once the labels reading is done (undefined before): the app drops AI Labels at 0.
      const counted = answer => {
        const count = readings.get(picture.hash)?.labelCount;
        return count === undefined ? answer : { ...answer, labelCount: count };
      };
      const failed = error => { throw error instanceof ImageError ? error : new ImageError('read-failed', 502); };
      if (view === 'read') {
        if (!await readable()) throw new ImageError('read-unavailable', 503);
        const text = await readout(picture).catch(failed);
        ahead();
        return counted({ text, view: 'read' });
      }
      if (view === 'labels') {
        if (!await readable()) throw new ImageError('read-unavailable', 503);
        const texts = await labelTexts(picture).catch(failed);
        // No printed text on a photo: Original Picture in its photo style, not a flat-tone copy with
        // "no text read"; the app then leaves AI Labels out for it. A chart keeps its AI Labels page.
        if (!texts.length && !isChart(picture)) return counted(screenView(picture, 'fit', 0, negative));
        return counted(labelsView(picture, texts, negative));
      }
      const answer = screenView(picture, view, region, negative);
      ahead();
      return counted(answer);
    },
  };
}

// View and region from a query or a JSON body (defaults: fit, 0).
export function readView(get) {
  const asked = get('view') ?? 'fit';
  const view = RETIRED_VIEWS[asked] ?? asked;
  const region = Number(get('region') ?? 0);
  const negative = get('negative');
  if (!VIEWS.has(view) || !Number.isSafeInteger(region) || region < 0 || region > 99 ||
      ![undefined, null, 'auto', 'on', 'off', true, false].includes(negative)) throw new ImageError('bad request', 400);
  return { view, region, negative: negative === 'on' || negative === true ? true : negative === 'off' || negative === false ? false : undefined };
}
