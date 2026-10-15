/// <reference lib="webworker" />
// Модуль выполняется здесь, а не в основном потоке — так же, как на сайте.
// Всё, что пересекает postMessage, проверяет structured clone.
import type { GameModule, SaveFile } from '@savemancer/sdk';
import type { Request, Response } from './protocol';
import { loadModule } from './registry';

let current: { module: GameModule; original: SaveFile[] } | undefined;

function countChanged(before: SaveFile[], after: SaveFile[]): number {
  let changed = 0;
  after.forEach((file, i) => {
    const prev = before[i]?.data ?? new Uint8Array();
    const len = Math.max(prev.byteLength, file.data.byteLength);
    for (let j = 0; j < len; j++) if (prev[j] !== file.data[j]) changed++;
  });
  return changed;
}

async function handle(req: Request): Promise<Response> {
  if (req.type === 'open') {
    const module = await loadModule(req.moduleId);
    if (module.detect && !module.detect(req.files)) throw new Error('файлы не похожи на сейв этой игры (detect вернул false)');
    const data = module.parse(req.files);
    current = { module, original: req.files };
    return { id: req.id, ok: true, type: 'opened', data, schema: module.schema(data) };
  }
  if (!current) throw new Error('сначала откройте сейв');
  const issues = current.module.validate?.(req.data) ?? [];
  const files = issues.some((i) => i.severity === 'error') ? [] : current.module.serialize(req.data, current.original);
  return { id: req.id, ok: true, type: 'saved', files, issues, changedBytes: countChanged(current.original, files) };
}

self.onmessage = async (event: MessageEvent<Request>) => {
  let res: Response;
  try {
    res = await handle(event.data);
  } catch (err) {
    res = { id: event.data.id, ok: false, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) };
  }
  self.postMessage(res);
};
