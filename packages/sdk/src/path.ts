import type { DataPath } from './types';

function segments(path: DataPath): string[] {
  return path === '' ? [] : path.split('.');
}

export function joinPath(...parts: (DataPath | number)[]): DataPath {
  return parts.filter((p) => p !== '').join('.');
}

export function getPath(data: unknown, path: DataPath): unknown {
  let cur: unknown = data;
  for (const key of segments(path)) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

export function setPath(data: unknown, path: DataPath, value: unknown): void {
  const keys = segments(path);
  const last = keys.pop();
  if (last === undefined) throw new Error('cannot set root path');
  const parent = getPath(data, keys.join('.'));
  if (parent === null || typeof parent !== 'object') throw new Error(`path not found: ${path}`);
  (parent as Record<string, unknown>)[last] = value;
}
