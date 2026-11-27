import fs from 'node:fs';
import path from 'node:path';

const [file, origin] = process.argv.slice(2);

try {
  let previous;
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile()) throw new Error('expected a regular file');
    previous = { text: fs.readFileSync(file, 'utf8'), mode: stat.mode & 0o777 };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  let config;
  try {
    config = previous ? JSON.parse(previous.text) : {};
  } catch {
    throw new Error('invalid JSON');
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('expected a JSON object');
  }

  // The first call validates the existing file before any Serve or startup changes.
  if (origin && config.publicOrigin !== origin) {
    config.publicOrigin = origin;
    const dir = fs.mkdtempSync(path.join(path.dirname(file), '.setup-macos-'));
    const staged = path.join(dir, 'config.json');
    try {
      fs.writeFileSync(staged, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
      if (previous) {
        fs.chmodSync(staged, previous.mode);
        if (fs.readFileSync(file, 'utf8') !== previous.text) {
          throw new Error('file changed during setup. Rerun setup to apply publicOrigin');
        }
        fs.renameSync(staged, file);
      } else {
        // Create atomically and fail if another process has already created the file.
        fs.linkSync(staged, file);
      }
    } finally {
      if (fs.existsSync(staged)) fs.unlinkSync(staged);
      fs.rmdirSync(dir);
    }
  }
} catch (error) {
  console.error(`Could not update ${file}: ${error.code ?? error.message}`);
  process.exitCode = 1;
}
