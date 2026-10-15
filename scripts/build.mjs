// Собирает каждый модуль в один ESM-файл и пишет dist/registry.json,
// который закрытый сайт использует как каталог игр.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';
import { listModules } from './modules.mjs';

const OUT = 'dist';
rmSync(OUT, { recursive: true, force: true });

const sdkVersion = JSON.parse(readFileSync('packages/sdk/package.json', 'utf8')).version;
const entries = [];
// Учебные модули (example-*) не публикуются на сайт; для локальной разработки: INCLUDE_EXAMPLES=1
const includeExamples = process.env.INCLUDE_EXAMPLES === '1';

for (const { dir, manifest } of listModules()) {
  if (manifest.id.startsWith('example-') && !includeExamples) continue;
  const file = `modules/${manifest.id}/${manifest.version}.js`;
  const outfile = join(OUT, file);
  mkdirSync(join(OUT, 'modules', manifest.id), { recursive: true });
  await build({
    entryPoints: [join(dir, 'src', 'index.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    minify: true,
    legalComments: 'none',
  });
  const integrity = 'sha384-' + createHash('sha384').update(readFileSync(outfile)).digest('base64');
  entries.push({ ...manifest, file, integrity });
}

writeFileSync(join(OUT, 'registry.json'), JSON.stringify({ sdk: sdkVersion, modules: entries }, null, 2));
console.log(`built ${entries.length} module(s) → ${OUT}/`);
