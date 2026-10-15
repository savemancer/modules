// Статические проверки модулей. Первая линия защиты — финальная всё равно ревью мейнтейнера
// и песочница (Web Worker без сети) на сайте.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { listModules } from './modules.mjs';

const PLATFORMS = ['pc', 'switch', 'ps4', 'ps5', 'xbox', 'mobile', 'other'];
const STATUSES = ['experimental', 'beta', 'stable'];
const SEMVER = /^\d+\.\d+\.\d+(-[\w.]+)?$/;

// Модуль — чистая функция над байтами. Сеть, DOM, хранилища и динамический код запрещены.
const FORBIDDEN = [
  [/\bfetch\s*\(/, 'fetch'],
  [/\bXMLHttpRequest\b/, 'XMLHttpRequest'],
  [/\bWebSocket\b/, 'WebSocket'],
  [/\bEventSource\b/, 'EventSource'],
  [/\bimportScripts\b/, 'importScripts'],
  [/\beval\s*\(/, 'eval'],
  [/\bnew\s+Function\b/, 'new Function'],
  [/\bimport\s*\(/, 'dynamic import'],
  [/\b(localStorage|sessionStorage|indexedDB|caches)\b/, 'storage APIs'],
  [/\b(document|window|globalThis|self|navigator|postMessage)\b/, 'global/DOM access'],
  [/\b(setTimeout|setInterval|queueMicrotask)\b/, 'timers'],
];
const IMPORT = /\bfrom\s+['"]([^'"]+)['"]|\bimport\s+['"]([^'"]+)['"]/g;

const errors = [];
const fail = (folder, msg) => errors.push(`modules/${folder}: ${msg}`);

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|js|mjs)$/.test(entry) ? [path] : [];
  });
}

function stripComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const modules = listModules();
for (const { folder, dir, manifest: m } of modules) {
  if (!m) {
    fail(folder, 'module.json missing');
    continue;
  }
  if (m.id !== folder) fail(folder, `id "${m.id}" must match folder name`);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(m.id ?? '')) fail(folder, 'id must be kebab-case');
  if (typeof m.game !== 'string' || !m.game) fail(folder, 'game is required');
  if (!SEMVER.test(m.version ?? '')) fail(folder, 'version must be semver');
  if (typeof m.sdk !== 'string') fail(folder, 'sdk range is required');
  if (!Array.isArray(m.authors) || m.authors.length === 0) fail(folder, 'authors must be a non-empty array');
  if (!STATUSES.includes(m.status)) fail(folder, `status must be one of ${STATUSES.join(', ')}`);
  if (!Array.isArray(m.platforms) || m.platforms.some((p) => !PLATFORMS.includes(p))) fail(folder, `platforms must be from ${PLATFORMS.join(', ')}`);
  if (!Array.isArray(m.files) || m.files.length === 0) fail(folder, 'files must list at least one pattern');

  if (!existsSync(join(dir, 'README.md'))) fail(folder, 'README.md missing');
  if (!existsSync(join(dir, 'src', 'index.ts'))) {
    fail(folder, 'src/index.ts missing');
    continue;
  }
  const testDir = join(dir, 'test');
  if (!existsSync(testDir) || !sourceFiles(testDir).some((f) => f.endsWith('.test.ts'))) fail(folder, 'at least one test/*.test.ts is required');

  for (const file of sourceFiles(join(dir, 'src'))) {
    const code = stripComments(readFileSync(file, 'utf8'));
    for (const [re, name] of FORBIDDEN) if (re.test(code)) fail(folder, `${file}: forbidden API (${name})`);
    for (const match of code.matchAll(IMPORT)) {
      const spec = match[1] ?? match[2];
      if (spec !== '@savemancer/sdk' && !spec.startsWith('./') && !spec.startsWith('../')) {
        fail(folder, `${file}: import "${spec}" not allowed (only @savemancer/sdk and relative)`);
      }
    }
  }
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`validated ${modules.length} module(s)`);
