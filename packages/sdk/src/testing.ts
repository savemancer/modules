import { getPath, joinPath } from './path';
import type { EditorSchema, Field, GameModule, SaveFile } from './types';

/**
 * Хелперы для тестов модулей. Каждый модуль обязан проходить roundTrip:
 * parse → serialize без изменений должен давать байт-в-байт исходный файл.
 */

export function roundTrip<T>(module: GameModule<T>, files: SaveFile[]): void {
  const data = module.parse(files);
  const out = module.serialize(structuredClone(data), files);
  if (out.length !== files.length) throw new Error(`expected ${files.length} files, got ${out.length}`);
  files.forEach((file, i) => {
    const result = out[i]!;
    if (result.name !== file.name) throw new Error(`file name changed: ${file.name} → ${result.name}`);
    const diff = firstDiff(file.data, result.data);
    if (diff !== -1) throw new Error(`${file.name}: bytes differ at 0x${diff.toString(16)}`);
  });
}

/** Проверяет, что данные модуля переживают postMessage и что все пути схемы существуют. */
export function checkSchema<T>(module: GameModule<T>, files: SaveFile[]): EditorSchema {
  const data = structuredClone(module.parse(files));
  const schema = structuredClone(module.schema(data));
  for (const tab of schema.tabs) checkFields(tab.fields, data, '');
  return schema;
}

function checkFields(fields: Field[], data: unknown, base: string): void {
  for (const field of fields) {
    if (field.kind === 'group') {
      checkFields(field.fields, data, base);
      continue;
    }
    const path = joinPath(base, field.path);
    const value = getPath(data, path);
    if (value === undefined) throw new Error(`schema path not found in data: ${path}`);
    if (field.kind === 'list') {
      if (!Array.isArray(value)) throw new Error(`list path is not an array: ${path}`);
      value.forEach((_, i) => checkFields(field.fields, data, joinPath(path, i)));
    }
  }
}

export function firstDiff(a: Uint8Array, b: Uint8Array): number {
  const len = Math.max(a.byteLength, b.byteLength);
  for (let i = 0; i < len; i++) if (a[i] !== b[i]) return i;
  return -1;
}
