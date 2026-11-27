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

// Edges only, 1 px wide; strong lines full, faint ones dimmer (never below level 7, so they show).
export function outline(picture) {
  const strength = thinEdges(picture);
  const levels = new Uint8Array(strength.length);
  for (let i = 0; i < levels.length; i++) if (strength[i] > 0) levels[i] = Math.max(7, Math.round(Math.sqrt(strength[i]) * 15));
  return levels;
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

// One 576x288 screen of a decoded picture for a view (fit, zoom or outline). negative: true or
// false as asked, undefined = automatic (mostly white pictures).
export function screenView(source, view = 'fit', region = 0, negative) {
  const { w, h, regions, region: r, x, y } = layout(source.width, source.height, view, region);
  const resampled = resample(source, w, h);
  const brightness = mean(resampled.pixels);
  const inverted = view !== 'outline' && (negative ?? brightness > 0.6);
  const scaled = inverted ? { ...resampled, pixels: resampled.pixels.map(v => 255 - v) } : resampled;
  const screen = new Uint8Array(IMAGE_WIDTH * IMAGE_HEIGHT);
  // Centre a smaller picture; crop a section of a larger one.
  const ox = w < IMAGE_WIDTH ? (IMAGE_WIDTH - w) >> 1 : -x, oy = h < IMAGE_HEIGHT ? (IMAGE_HEIGHT - h) >> 1 : -y;
  // Both work on the picture alone, so the edge between the picture and the black padding does not
  // become a line.
  const style = view === 'outline' ? 'outline' : pictureStyle(scaled.pixels);
  const tone = style === 'outline' ? outline(scaled) : style === 'graphic' ? flatLevels(scaled.pixels) : g2Picture(scaled);
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
const forModel = (ffmpeg, bytes) => /^\x89PNG/.test(bytes.subarray(0, 4).toString('latin1')) ? Promise.resolve(bytes)
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
    async render(key, load, { view = 'fit', region = 0, negative } = {}) {
      if (!VIEWS.has(view) || !Number.isSafeInteger(region) || region < 0 || region > 99) throw new ImageError('bad request', 400);
      const picture = await source(key, load);
      return view === 'read' ? read(key, picture) : screenView(picture, view, region, negative);
    },
  };
}

// View and region from a query or a JSON body (defaults: fit, 0).
export function readView(get) {
  const view = get('view') ?? 'fit';
  const region = Number(get('region') ?? 0);
  const negative = get('negative');
  if (!VIEWS.has(view) || !Number.isSafeInteger(region) || region < 0 || region > 99 ||
      ![undefined, null, 'auto', 'on', 'off', true, false].includes(negative)) throw new ImageError('bad request', 400);
  return { view, region, negative: negative === 'on' || negative === true ? true : negative === 'off' || negative === false ? false : undefined };
}
