// Images for the glasses (Eugene, 2026-11-27: Chat photos, Email images, Coding screenshots).
// ffmpeg decodes the picture once (stdin only, image demuxers only, one frame, size and time limits)
// to 8-bit grey at up to 2400 px; the views are computed here from that copy:
// - fit:     the whole picture inside 576x288, contrast stretched, dithered to 16 levels.
// - zoom:    at least twice the fit size (a tall screenshot fills the width), read in 576x288
//            sections in reading order; `region` picks the section, `regions` says how many.
// - outline: edges only (Sobel), lit lines on black, no dithering (G2 1.0.81: dithered greys of
//            photos and charts were hard to read on the waveguide).
// - read:    the local vision model (Ollama) reads the picture as text: chart values, screen text,
//            or two or three lines on a photo (Eugene: "AI even?"; a KPI chart read correctly in 20 s).
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { executable } from './platform.mjs';

export const IMAGE_WIDTH = 576, IMAGE_HEIGHT = 288;
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
export const VIEWS = new Set(['fit', 'zoom', 'outline', 'read']);
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

// Sobel edge strength, scaled so the strongest 1% reach full level; weak edges are dropped.
export function outline({ width, height, pixels }) {
  const magnitude = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const p = (dx, dy) => pixels[(y + dy) * width + x + dx];
    const gx = p(1, -1) + 2 * p(1, 0) + p(1, 1) - p(-1, -1) - 2 * p(-1, 0) - p(-1, 1);
    const gy = p(-1, 1) + 2 * p(0, 1) + p(1, 1) - p(-1, -1) - 2 * p(0, -1) - p(1, -1);
    magnitude[y * width + x] = Math.hypot(gx, gy);
  }
  const sorted = Float32Array.from(magnitude).sort();
  const top = sorted[Math.floor(sorted.length * 0.99)] || 1;
  const levels = new Uint8Array(width * height);
  for (let i = 0; i < levels.length; i++) {
    const v = Math.min(1, magnitude[i] / top);
    levels[i] = v < 0.18 ? 0 : Math.round(Math.sqrt(v) * 15);
  }
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

// One 576x288 screen of a decoded picture for a view (fit, zoom or outline).
export function screenView(source, view = 'fit', region = 0) {
  const { w, h, regions, region: r, x, y } = layout(source.width, source.height, view, region);
  const scaled = resample(source, w, h);
  const screen = new Uint8Array(IMAGE_WIDTH * IMAGE_HEIGHT);
  // Centre a smaller picture; crop a section of a larger one.
  const ox = w < IMAGE_WIDTH ? (IMAGE_WIDTH - w) >> 1 : -x, oy = h < IMAGE_HEIGHT ? (IMAGE_HEIGHT - h) >> 1 : -y;
  // Outline works on the picture alone, so the edge between the picture and the black padding
  // does not become a line.
  const tone = view === 'outline' ? outline(scaled) : stretch(scaled.pixels);
  for (let yy = 0; yy < h; yy++) {
    const sy = yy + oy;
    if (sy < 0 || sy >= IMAGE_HEIGHT) continue;
    for (let xx = 0; xx < w; xx++) {
      const sx = xx + ox;
      if (sx >= 0 && sx < IMAGE_WIDTH) screen[sy * IMAGE_WIDTH + sx] = tone[yy * w + xx];
    }
  }
  if (view === 'outline') return { width: IMAGE_WIDTH, height: IMAGE_HEIGHT, data: packLevels(screen), mean: 0, view, regions, region: r };
  return { ...glassImage(screen), view, regions, region: r };
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
// The model reads JPEG and PNG; anything else (WebP, HEIC, GIF) goes as a PNG of at most 1600 px.
const forModel = (ffmpeg, bytes) => /^\xff\xd8|^\x89PNG/.test(bytes.subarray(0, 4).toString('latin1')) ? Promise.resolve(bytes)
  : run(ffmpeg, [...INPUT, '-vf', "scale='min(1600,iw)':'min(1600,ih)':force_original_aspect_ratio=decrease", '-f', 'image2pipe', '-c:v', 'png', 'pipe:1'], bytes, MAX_IMAGE_BYTES);

// ffmpeg from PATH, else the configured path; `model` the Ollama vision model for the Read view.
export function createImaging({ ffmpeg, model, transport = fetch } = {}) {
  const path = () => executable('ffmpeg') || (ffmpeg && existsSync(ffmpeg) ? ffmpeg : undefined);
  const sources = new Map(), reads = new Map();
  let queue = Promise.resolve(), readQueue = Promise.resolve();
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
    const pending = queue.then(() => decode(ffmpeg, bytes));
    queue = pending.catch(() => {});
    const value = { ...(await pending), bytes };
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
  async function read(key, picture) {
    if (key !== null && reads.has(key)) return reads.get(key);
    if (!await readable()) throw new ImageError('read-unavailable', 503);
    const ffmpeg = path();
    const image = await forModel(ffmpeg, picture.bytes);
    const pending = readQueue.then(async () => {
      const res = await transport(`${OLLAMA}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, stream: false, think: false, options: { temperature: 0 },
          messages: [{ role: 'user', content: READ_PROMPT, images: [image.toString('base64')] }] }),
        signal: AbortSignal.timeout(180000) });
      const text = res.ok ? String((await res.json()).message?.content ?? '').trim() : '';
      if (!text) throw new ImageError('read-failed', 502);
      return { text: text.slice(0, 4000), view: 'read' };
    });
    readQueue = pending.catch(() => {});
    const value = await pending.catch(error => { throw error instanceof ImageError ? error : new ImageError('read-failed', 502); });
    if (key !== null) remember(reads, key, value, 24);
    return value;
  }
  return {
    available: () => Boolean(path()),
    readable,
    // key: a stable id for the source (chat message, mail part) or null (not cached).
    async render(key, load, { view = 'fit', region = 0 } = {}) {
      if (!VIEWS.has(view) || !Number.isSafeInteger(region) || region < 0 || region > 99) throw new ImageError('bad request', 400);
      const picture = await source(key, load);
      return view === 'read' ? read(key, picture) : screenView(picture, view, region);
    },
  };
}

// View and region from a query or a JSON body (defaults: fit, 0).
export function readView(get) {
  const view = get('view') ?? 'fit';
  const region = Number(get('region') ?? 0);
  if (!VIEWS.has(view) || !Number.isSafeInteger(region) || region < 0 || region > 99) throw new ImageError('bad request', 400);
  return { view, region };
}
