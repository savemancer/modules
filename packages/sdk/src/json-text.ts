/**
 * JSON с точечной правкой: запоминает, где в тексте лежит каждое примитивное значение,
 * и при записи заменяет только изменённые значения. Остальной текст (форматирование чисел
 * вроде 1.0, порядок ключей, пробелы) сохраняется байт-в-байт — важно для сейвов Unity/Gson.
 */
export type JsonPath = (string | number)[];
export type JsonPrimitive = string | number | boolean | null;

interface Span {
  start: number;
  end: number;
}

export class JsonText {
  readonly value: unknown;
  private readonly spans = new Map<string, Span>();
  private readonly edits = new Map<string, { span: Span; text: string }>();
  private pos = 0;

  constructor(readonly text: string) {
    this.value = JSON.parse(text);
    this.skipWs();
    this.parseValue([]);
  }

  has(path: JsonPath): boolean {
    return this.spans.has(key(path));
  }

  get(path: JsonPath): unknown {
    let cur: unknown = this.value;
    for (const k of path) {
      if (cur === null || typeof cur !== 'object') return undefined;
      cur = (cur as Record<string, unknown>)[k as string];
    }
    return cur;
  }

  /** Заменить примитив. Поле должно существовать — структура JSON не меняется. */
  set(path: JsonPath, value: JsonPrimitive): void {
    const span = this.spans.get(key(path));
    if (!span) throw new Error(`JSON path not found: ${path.join('.')}`);
    const current = this.text.slice(span.start, span.end);
    if (JSON.stringify(JSON.parse(current)) === JSON.stringify(value)) {
      this.edits.delete(key(path));
      return;
    }
    this.edits.set(key(path), { span, text: JSON.stringify(value) });
  }

  get changed(): boolean {
    return this.edits.size > 0;
  }

  toString(): string {
    let out = this.text;
    for (const { span, text } of [...this.edits.values()].sort((a, b) => b.span.start - a.span.start)) {
      out = out.slice(0, span.start) + text + out.slice(span.end);
    }
    return out;
  }

  private skipWs(): void {
    while (/\s/.test(this.text[this.pos] ?? '')) this.pos++;
  }

  private parseValue(path: JsonPath): void {
    const ch = this.text[this.pos];
    if (ch === '{') return this.parseObject(path);
    if (ch === '[') return this.parseArray(path);
    const start = this.pos;
    if (ch === '"') this.skipString();
    else while (this.pos < this.text.length && !/[\s,\]}]/.test(this.text[this.pos]!)) this.pos++;
    this.spans.set(key(path), { start, end: this.pos });
  }

  private parseObject(path: JsonPath): void {
    this.pos++;
    this.skipWs();
    if (this.text[this.pos] === '}') return void this.pos++;
    for (;;) {
      this.skipWs();
      const keyStart = this.pos;
      this.skipString();
      const name = JSON.parse(this.text.slice(keyStart, this.pos)) as string;
      this.skipWs();
      this.pos++; // :
      this.skipWs();
      this.parseValue([...path, name]);
      this.skipWs();
      if (this.text[this.pos++] === '}') return;
    }
  }

  private parseArray(path: JsonPath): void {
    this.pos++;
    this.skipWs();
    if (this.text[this.pos] === ']') return void this.pos++;
    for (let i = 0; ; i++) {
      this.skipWs();
      this.parseValue([...path, i]);
      this.skipWs();
      if (this.text[this.pos++] === ']') return;
    }
  }

  private skipString(): void {
    this.pos++;
    while (this.pos < this.text.length) {
      const ch = this.text[this.pos++];
      if (ch === '\\') this.pos++;
      else if (ch === '"') return;
    }
  }
}

function key(path: JsonPath): string {
  return JSON.stringify(path);
}
