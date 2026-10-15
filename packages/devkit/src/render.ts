import { getPath, joinPath, setPath, type EditorSchema, type Field } from '@savemancer/sdk';

/** Минимальный рендерер схемы. На сайте свой, но поддерживает тот же набор полей. */
export function renderEditor(root: HTMLElement, schema: EditorSchema, data: unknown): void {
  root.replaceChildren();
  const tabs = el('nav', 'tabs');
  const body = el('div');
  root.append(tabs, body);

  schema.tabs.forEach((tab, i) => {
    const button = el('button', 'tab', tab.label);
    button.onclick = () => {
      tabs.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
      button.classList.add('active');
      body.replaceChildren(...tab.fields.map((f) => renderField(f, data, '')));
    };
    tabs.append(button);
    if (i === 0) button.click();
  });
}

function renderField(field: Field, data: unknown, base: string): HTMLElement {
  if (field.kind === 'group') {
    const details = el('details', 'group');
    details.open = !field.collapsed;
    details.append(el('summary', '', field.label), ...field.fields.map((f) => renderField(f, data, base)));
    return details;
  }

  const path = joinPath(base, field.path);
  if (field.kind === 'list') {
    const items = getPath(data, path) as unknown[];
    const wrap = el('div', 'list');
    wrap.append(el('h3', '', field.label));
    items.forEach((item, i) => {
      const details = el('details', 'group');
      const summary = el('summary', '', formatLabel(field.itemLabel, item));
      details.append(summary, ...field.fields.map((f) => renderField(f, data, joinPath(path, i))));
      details.addEventListener('input', () => (summary.textContent = formatLabel(field.itemLabel, item)));
      wrap.append(details);
    });
    return wrap;
  }

  const row = el('label', 'field');
  row.append(el('span', 'label', field.label));
  const value = getPath(data, path);
  let input: HTMLInputElement | HTMLSelectElement;

  switch (field.kind) {
    case 'number': {
      const n = (input = document.createElement('input'));
      n.type = 'number';
      n.value = String(value);
      if (field.min !== undefined) n.min = String(field.min);
      if (field.max !== undefined) n.max = String(field.max);
      n.step = field.integer === false ? 'any' : '1';
      n.oninput = () => {
        const v = Number(n.value);
        const ok = n.value !== '' && n.checkValidity();
        n.classList.toggle('invalid', !ok);
        if (ok) setPath(data, path, v);
      };
      break;
    }
    case 'text': {
      const t = (input = document.createElement('input'));
      t.value = String(value);
      if (field.maxLength !== undefined) t.maxLength = field.maxLength;
      t.oninput = () => setPath(data, path, t.value);
      break;
    }
    case 'toggle': {
      const c = (input = document.createElement('input'));
      c.type = 'checkbox';
      c.checked = Boolean(value);
      c.onchange = () => setPath(data, path, c.checked);
      break;
    }
    case 'select': {
      const s = (input = document.createElement('select'));
      for (const opt of field.options) s.append(new Option(opt.label, String(opt.value), false, opt.value === value));
      if (!field.options.some((o) => o.value === value)) s.append(new Option(`Неизвестно (${String(value)})`, String(value), false, true));
      s.onchange = () => setPath(data, path, typeof value === 'number' ? Number(s.value) : s.value);
      break;
    }
  }
  input.disabled = Boolean(field.readonly);
  input.dataset.path = path;
  row.append(input);
  if (field.hint) row.append(el('small', 'hint', field.hint));
  return row;
}

function formatLabel(template: string, item: unknown): string {
  return template.replace(/\{([\w.]+)\}/g, (_, key: string) => String(getPath(item, key) ?? ''));
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
