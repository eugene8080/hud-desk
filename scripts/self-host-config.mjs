import { randomUUID } from 'node:crypto';
import { linkSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseOrigin } from '../app/src/bridge-origin.mjs';

const configPath = fileURLToPath(new URL('../bridge/config.local.json', import.meta.url));

export function readLocalConfig(path = configPath) {
  try {
    const config = JSON.parse(readFileSync(path, 'utf8'));
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      throw new Error('bridge/config.local.json must contain a JSON object.');
    }
    return config;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    if (error instanceof SyntaxError) throw new Error('Fix invalid JSON in bridge/config.local.json and rerun setup.');
    throw error;
  }
}

export function savePublicOrigin(text, path = configPath) {
  const origin = parseOrigin(text);
  if (!origin) throw new Error('The Tailscale address is not a valid HTTPS origin.');
  const existing = readLocalConfig(path);
  if (existing?.publicOrigin === origin) return 'already set';

  // Publish a complete JSON file. Exclusive creation protects a config created
  // after the first read, and a rerun with the same origin does not rewrite it.
  const pending = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(pending, JSON.stringify({ ...existing, publicOrigin: origin }, null, 2) + '\n', {
      flag: 'wx', mode: 0o600,
    });
    if (existing) renameSync(pending, path);
    else linkSync(pending, path);
  } finally {
    rmSync(pending, { force: true });
  }
  return existing ? 'merged publicOrigin' : 'created minimal config';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv[2] === '--check') readLocalConfig();
    else console.log(`Bridge config: ${savePublicOrigin(process.argv[2])}.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
