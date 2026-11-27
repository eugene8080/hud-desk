// トークンと連絡板のトピック名。bridge とトンネル監視のどちらが先に起動しても同じ値を使う
import { linkSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('.', import.meta.url));

function secret(name, make) {
  const file = join(dir, name);
  try {
    // 'wx' は既にあれば失敗する。同時起動でも片方の値だけが残る
    writeFileSync(file, make(), { mode: 0o600, flag: 'wx' });
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }
  return readFileSync(file, 'utf8').trim();
}

export const token = () => secret('.token', () => randomBytes(18).toString('base64url'));
export const topic = () => secret('.topic', () => 'eho-' + randomBytes(12).toString('base64url'));
export function relaySecrets(make) {
  const file = join(dir, '.relay-identity');
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  // Publish both credentials together. Concurrent bridge start and pairing must
  // see either the winning complete file or no file, never a partial JSON write.
  const pending = `${file}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    writeFileSync(pending, make(), { mode: 0o600, flag: 'wx' });
    linkSync(pending, file);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  } finally {
    try { unlinkSync(pending); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return readFileSync(file, 'utf8');
}
