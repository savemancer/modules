// Создаёт новый модуль из шаблона: npm run new-module -- persona-3-reload "Persona 3 Reload"
import { cpSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [id, game] = process.argv.slice(2);
if (!id || !game || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) {
  console.error('usage: npm run new-module -- <kebab-case-id> "<Game Title>"');
  process.exit(1);
}
const target = join('modules', id);
if (existsSync(target)) {
  console.error(`${target} already exists`);
  process.exit(1);
}
cpSync(join('templates', 'module'), target, { recursive: true });

function substitute(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) substitute(path);
    else writeFileSync(path, readFileSync(path, 'utf8').replaceAll('__ID__', id).replaceAll('__GAME__', game));
  }
}
substitute(target);
console.log(`created ${target} — next: npm run dev, then fill in src/index.ts`);
