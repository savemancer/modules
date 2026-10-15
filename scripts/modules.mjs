import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const MODULES_DIR = 'modules';

export function listModules() {
  return readdirSync(MODULES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      const dir = join(MODULES_DIR, e.name);
      const manifestPath = join(dir, 'module.json');
      const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null;
      return { folder: e.name, dir, manifest };
    });
}
