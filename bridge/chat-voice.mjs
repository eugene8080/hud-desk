import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { executable } from './platform.mjs';

const script = fileURLToPath(new URL('./chat-voice.py', import.meta.url));
const voiceDir = fileURLToPath(new URL('../.local/voice/', import.meta.url));
export const MAX_ASSET_BYTES = 32 * 1024 * 1024;
const MAX_SECONDS = 300;

async function convert(ffmpeg, source, wav) {
  // A seekable input handles M4A files with their index at the end. Keep
  // playlists and network protocols out of the demuxer.
  await new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, [
      '-nostdin', '-loglevel', 'error', '-protocol_whitelist', 'file',
      '-format_whitelist', 'ogg,mov,mp3,aac,wav,matroska,webm,amr,flac',
      '-i', source, '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000',
      '-t', String(MAX_SECONDS + 1), '-c:a', 'pcm_s16le', '-f', 'wav', wav,
    ], { windowsHide: true, stdio: 'ignore', signal: AbortSignal.timeout(60000) });
    // Wait for close even after abort, so Windows can remove the input file.
    child.on('error', () => {});
    child.on('close', code => code === 0 ? resolve() : reject(new Error('Audio conversion failed')));
  });
}

function startWorker(python, settings) {
  const args = ['-I', '-u', script, settings.language, settings.script, String(MAX_SECONDS),
    settings.modelDir || '', settings.vadDir || ''];
  const child = spawn(python, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  const lines = createInterface({ input: child.stdout });
  let pending, stopped = false;
  function complete(value, error) {
    if (!pending) return;
    const { timer, resolve, reject } = pending;
    pending = undefined;
    clearTimeout(timer);
    if (error) reject(error);
    else resolve(value);
  }
  function stop() {
    if (stopped) return;
    stopped = true;
    lines.close();
    child.kill();
    complete(null, new Error('Chat speech worker stopped'));
  }
  child.on('error', stop);
  child.stdin.on('error', stop);
  lines.on('close', stop);
  lines.on('line', line => {
    try { complete(JSON.parse(line)); } catch { stop(); }
  });

  function receive(wav, timeout) {
    return new Promise((resolve, reject) => {
      if (stopped) { reject(new Error('Chat speech worker stopped')); return; }
      pending = { resolve, reject, timer: setTimeout(stop, timeout) };
      if (wav) child.stdin.write(JSON.stringify({ wav }) + '\n');
    });
  }
  const ready = receive(null, 90000).then(value => {
    if (value?.ready !== true) throw new Error('Chat speech setup required');
  });
  return {
    get alive() { return !stopped; },
    async transcribe(wav) {
      await ready;
      return receive(wav, 120000);
    },
    stop,
  };
}

export function createChatSpeech(settings) {
  let queue = Promise.resolve(), idle, worker;
  let closed = false;
  const stop = () => { clearTimeout(idle); worker?.stop(); worker = undefined; };
  process.once('exit', stop);
  const ffmpegPath = () => executable('ffmpeg') || (settings.ffmpeg && existsSync(settings.ffmpeg) ? settings.ffmpeg : undefined);
  const pythonPath = () => {
    const venv = process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python';
    const localPython = join(voiceDir, 'venv', venv);
    if (settings.python) return existsSync(settings.python) ? settings.python : undefined;
    return existsSync(localPython) ? localPython : executable('python');
  };
  return {
    // Offered to the app only when both tools exist; models are checked by the worker on first use.
    available: () => !closed && Boolean(ffmpegPath() && pythonPath()),
    transcribe(loadAudio) {
      const work = queue.then(async () => {
        const ffmpeg = ffmpegPath();
        const python = pythonPath();
        if (closed || !ffmpeg || !python) throw new Error('Chat speech setup required');
        clearTimeout(idle);
        let folder;
        try {
          folder = await mkdtemp(join(tmpdir(), 'orca-glass-audio-'));
          const source = join(folder, 'audio');
          const wav = join(folder, 'audio.wav');
          await writeFile(source, await loadAudio());
          await convert(ffmpeg, source, wav);
          if (closed) throw new Error('Chat speech stopped');
          if (!worker?.alive) worker = startWorker(python, settings);
          try {
            return await worker.transcribe(wav);
          } catch (error) {
            stop();
            throw error;
          }
        } finally {
          if (!closed && worker) { idle = setTimeout(stop, 120000); idle.unref(); }
          if (folder) await rm(folder, { recursive: true, force: true, maxRetries: 3 });
        }
      });
      queue = work.catch(() => {});
      return work;
    },
    close() { closed = true; stop(); process.removeListener('exit', stop); },
  };
}
