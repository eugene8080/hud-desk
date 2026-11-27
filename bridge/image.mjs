// Images for the glasses (Eugene, 2026-11-27: Chat photos, Email images, Coding screenshots).
// ffmpeg decodes the picture from stdin, fits it inside 576x288 (the G2 canvas) on black and
// returns 8-bit grey; this module dithers it to the panel's 16 levels (Floyd-Steinberg) and packs
// two pixels a byte. The input is untrusted (it comes from chats, mail and transcripts): ffmpeg
// reads only the pipe, only image demuxers, one frame, under a size and time limit.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { executable } from './platform.mjs';

export const IMAGE_WIDTH = 576, IMAGE_HEIGHT = 288;
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const FORMATS = 'png_pipe,jpeg_pipe,webp_pipe,gif,bmp_pipe,tiff_pipe,image2pipe,mov';
const FILTER = `scale=${IMAGE_WIDTH}:${IMAGE_HEIGHT}:force_original_aspect_ratio=decrease:flags=area,` +
  `pad=${IMAGE_WIDTH}:${IMAGE_HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=black,format=gray`;

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

// The answer the app draws: width, height, packed levels and the mean brightness (0..1), which
// the app uses to show a mostly white picture (a light-mode screenshot) in negative by default.
export function glassImage(grey) {
  if (grey.length !== IMAGE_WIDTH * IMAGE_HEIGHT) throw new ImageError('image-failed', 502);
  let sum = 0;
  for (const value of grey) sum += value;
  return { width: IMAGE_WIDTH, height: IMAGE_HEIGHT, data: packLevels(ditherLevels(grey)), mean: sum / grey.length / 255 };
}

function decode(ffmpeg, bytes) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, ['-loglevel', 'error', '-protocol_whitelist', 'pipe', '-format_whitelist', FORMATS,
      '-i', 'pipe:0', '-frames:v', '1', '-vf', FILTER, '-f', 'rawvideo', 'pipe:1'],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'], signal: AbortSignal.timeout(20000) });
    const chunks = [];
    let size = 0;
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > IMAGE_WIDTH * IMAGE_HEIGHT) child.kill();
      else chunks.push(chunk);
    });
    child.on('error', () => reject(new ImageError('image-failed', 502)));
    // A decoder that stops reading early closes stdin; that is not an error here.
    child.stdin.on('error', () => {});
    child.on('close', code => {
      const grey = Buffer.concat(chunks);
      if (code === 0 && grey.length === IMAGE_WIDTH * IMAGE_HEIGHT) resolve(grey);
      else reject(new ImageError('image-failed', 502));
    });
    child.stdin.end(bytes);
  });
}

// ffmpeg from PATH, else the configured path (the Chat voice set-up has one).
export function createImaging({ ffmpeg } = {}) {
  const path = () => executable('ffmpeg') || (ffmpeg && existsSync(ffmpeg) ? ffmpeg : undefined);
  const cache = new Map();
  let queue = Promise.resolve();
  return {
    available: () => Boolean(path()),
    // key: a stable id for the source (chat message, mail part, transcript image) for the cache.
    async render(key, load) {
      if (key !== null && cache.has(key)) {
        const hit = cache.get(key);
        cache.delete(key);
        cache.set(key, hit);
        return hit;
      }
      const ffmpeg = path();
      if (!ffmpeg) throw new ImageError('images-unavailable', 503);
      const bytes = await load();
      if (!bytes?.length || bytes.length > MAX_IMAGE_BYTES) throw new ImageError('image-failed', 502);
      // One decode at a time: a page of photos must not start a dozen ffmpeg processes.
      const run = queue.then(() => decode(ffmpeg, bytes));
      queue = run.catch(() => {});
      const image = glassImage(await run);
      if (key !== null) cache.set(key, image);
      if (cache.size > 24) cache.delete(cache.keys().next().value);
      return image;
    },
  };
}
