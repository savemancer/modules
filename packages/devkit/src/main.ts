import type { SaveFile } from '@savemancer/sdk';
import type { RequestBody, Response } from './protocol';
import { listManifests } from './registry';
import { renderEditor } from './render';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const select = $<HTMLSelectElement>('module');
const info = $('info');
const drop = $('drop');
const fileInput = $<HTMLInputElement>('file');
const status = $('status');
const editor = $('editor');

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
let nextId = 0;
const pending = new Map<number, (res: Response) => void>();
worker.onmessage = (e: MessageEvent<Response>) => pending.get(e.data.id)?.(e.data);

function call(req: RequestBody): Promise<Response> {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, (res) => {
      pending.delete(id);
      resolve(res);
    });
    worker.postMessage({ ...req, id });
  });
}

function setStatus(text: string, kind: 'ok' | 'error' | '' = '') {
  status.textContent = text;
  status.className = kind;
}

const manifests = listManifests();
for (const m of manifests) select.append(new Option(`${m.game} — v${m.version} (${m.status})`, m.id));

function showInfo() {
  const m = manifests.find((x) => x.id === select.value);
  if (!m) return;
  const locations = Object.entries(m.saveLocations ?? {}).flatMap(([platform, paths]) => paths.map((p) => `${platform}: ${p}`));
  info.innerHTML = '';
  const files = m.files.map((f) => `${f.pattern}${f.description ? ` — ${f.description}` : ''}`).join(', ');
  info.append(Object.assign(document.createElement('p'), { textContent: `Файлы: ${files}` }));
  for (const loc of locations) info.append(Object.assign(document.createElement('code'), { textContent: loc }));
  fileInput.accept = m.files.map((f) => f.pattern.replace(/^\*/, '')).join(',');
  editor.replaceChildren();
  setStatus('');
}
select.onchange = showInfo;
showInfo();

async function open(list: FileList | null) {
  if (!list?.length) return;
  const files: SaveFile[] = await Promise.all([...list].map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })));
  const res = await call({ type: 'open', moduleId: select.value, files });
  if (!res.ok) return setStatus(res.error, 'error');
  if (res.type !== 'opened') return;

  const data = res.data;
  renderEditor(editor, res.schema, data);
  const save = Object.assign(document.createElement('button'), { textContent: 'Сохранить и скачать', className: 'primary' });
  save.onclick = () => download(data);
  editor.append(save);
  setStatus(`Открыто: ${files.map((f) => f.name).join(', ')}`, 'ok');
}

async function download(data: unknown) {
  editor.querySelectorAll('.issue').forEach((n) => n.classList.remove('issue'));
  const res = await call({ type: 'save', data });
  if (!res.ok) return setStatus(res.error, 'error');
  if (res.type !== 'saved') return;
  for (const issue of res.issues) editor.querySelector(`[data-path="${issue.path}"]`)?.classList.add('issue');
  const msgs = res.issues.map((i) => `${i.severity === 'error' ? '✖' : '⚠'} ${i.path}: ${i.message}`);
  if (!res.files.length) return setStatus(msgs.join('\n'), 'error');
  for (const f of res.files) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([new Uint8Array(f.data)]));
    a.download = f.name;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  setStatus([`Сохранено, изменено байт: ${res.changedBytes}`, ...msgs].join('\n'), 'ok');
}

fileInput.onchange = () => open(fileInput.files);
drop.ondragover = (e) => {
  e.preventDefault();
  drop.classList.add('over');
};
drop.ondragleave = () => drop.classList.remove('over');
drop.ondrop = (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  open(e.dataTransfer?.files ?? null);
};
