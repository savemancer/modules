import { SaveFormatError } from './types';

/**
 * Сохранения Unreal Engine (формат GVAS, UE 5.4+ с «полными именами типов» в тегах свойств).
 *
 * Принцип: всё, что разобрано, записывается обратно тем же способом; всё, что разобрать не удалось
 * (или разбор не сошёлся с объявленным размером), хранится сырыми байтами. Поэтому
 * parse → serialize без изменений даёт байт-в-байт исходный файл.
 */

/** Тип свойства: дерево имён, например MapProperty<NameProperty, StructProperty<S_Item, /Game/...>> */
export interface GvasType {
  name: string;
  params: GvasType[];
}

export type GvasValue =
  | { kind: 'int'; value: number }
  | { kind: 'int64'; value: bigint }
  | { kind: 'float'; value: number }
  | { kind: 'double'; value: number }
  | { kind: 'bool'; value: boolean }
  | { kind: 'string'; value: string }
  | { kind: 'byte'; value: number }
  | { kind: 'struct'; props: GvasProperty[] }
  | { kind: 'array'; items: GvasValue[] }
  | { kind: 'map'; removed: number; entries: [GvasValue, GvasValue][] }
  | { kind: 'set'; removed: number; items: GvasValue[] }
  | { kind: 'raw'; bytes: Uint8Array };

export interface GvasProperty {
  name: string;
  type: GvasType;
  flags: number;
  arrayIndex?: number;
  guid?: Uint8Array;
  extensions?: number;
  value: GvasValue;
}

export interface GvasFile {
  /** Заголовок (версии движка, custom versions, класс сохранения) — не редактируется */
  header: Uint8Array;
  props: GvasProperty[];
  /** Байты после завершающего None */
  trailer: Uint8Array;
}

const FLAG_ARRAY_INDEX = 0x01;
const FLAG_GUID = 0x02;
const FLAG_EXTENSIONS = 0x04;
const FLAG_BINARY = 0x08;
const FLAG_BOOL_TRUE = 0x10;

const INT_SIZES: Record<string, { size: number; signed: boolean }> = {
  Int8Property: { size: 1, signed: true },
  Int16Property: { size: 2, signed: true },
  IntProperty: { size: 4, signed: true },
  UInt16Property: { size: 2, signed: false },
  UInt32Property: { size: 4, signed: false },
};
const STRING_TYPES = new Set(['StrProperty', 'NameProperty', 'ObjectProperty', 'EnumProperty']);
/** Структуры с нативной (не потеговой) сериализацией внутри контейнеров: имя → размер в байтах */
const NATIVE_STRUCTS: Record<string, number> = { Guid: 16, DateTime: 8, Timespan: 8 };

class ParseFailure extends Error {}

class Reader {
  readonly view: DataView;
  offset: number;

  constructor(readonly bytes: Uint8Array, offset = 0) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.offset = offset;
  }

  private take(size: number): number {
    if (size < 0 || this.offset + size > this.bytes.byteLength) throw new ParseFailure(`out of bounds at 0x${this.offset.toString(16)}`);
    const at = this.offset;
    this.offset += size;
    return at;
  }

  u8(): number { return this.view.getUint8(this.take(1)); }
  i32(): number { return this.view.getInt32(this.take(4), true); }
  bytesOf(size: number): Uint8Array { const at = this.take(size); return this.bytes.slice(at, at + size); }

  fstring(): string {
    const length = this.i32();
    if (length === 0) return '';
    if (length > 0) {
      if (length > 1 << 20) throw new ParseFailure('string too long');
      const at = this.take(length);
      return decodeLatin1(this.bytes.subarray(at, at + length - 1));
    }
    const chars = -length;
    if (chars > 1 << 20) throw new ParseFailure('string too long');
    const at = this.take(chars * 2);
    return new TextDecoder('utf-16le').decode(this.bytes.subarray(at, at + (chars - 1) * 2));
  }
}

class Writer {
  private chunks: Uint8Array[] = [];
  length = 0;

  bytes(data: Uint8Array): void {
    this.chunks.push(data);
    this.length += data.byteLength;
  }

  private num(size: number, set: (view: DataView) => void): void {
    const buf = new Uint8Array(size);
    set(new DataView(buf.buffer));
    this.bytes(buf);
  }

  u8(v: number): void { this.num(1, (d) => d.setUint8(0, v)); }
  i32(v: number): void { this.num(4, (d) => d.setInt32(0, v, true)); }

  fstring(value: string): void {
    if (value === '') return this.i32(0);
    if (/^[\x00-\x7f]*$/.test(value)) {
      this.i32(value.length + 1);
      const buf = new Uint8Array(value.length + 1);
      for (let i = 0; i < value.length; i++) buf[i] = value.charCodeAt(i);
      this.bytes(buf);
      return;
    }
    this.i32(-(value.length + 1));
    const buf = new Uint8Array((value.length + 1) * 2);
    const view = new DataView(buf.buffer);
    for (let i = 0; i < value.length; i++) view.setUint16(i * 2, value.charCodeAt(i), true);
    this.bytes(buf);
  }

  toBytes(): Uint8Array {
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const c of this.chunks) {
      out.set(c, at);
      at += c.byteLength;
    }
    return out;
  }
}

function decodeLatin1(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
}

// ---------------- чтение ----------------

function readType(r: Reader): GvasType {
  const name = r.fstring();
  const count = r.i32();
  if (count < 0 || count > 16) throw new ParseFailure(`bad type parameter count ${count}`);
  const params: GvasType[] = [];
  for (let i = 0; i < count; i++) params.push(readType(r));
  return { name, params };
}

function readProps(r: Reader, end: number): GvasProperty[] {
  const props: GvasProperty[] = [];
  while (r.offset < end) {
    const name = r.fstring();
    if (name === 'None') return props;
    const type = readType(r);
    const size = r.i32();
    const flags = r.u8();
    const prop: GvasProperty = { name, type, flags, value: { kind: 'raw', bytes: new Uint8Array() } };
    if (flags & FLAG_ARRAY_INDEX) prop.arrayIndex = r.i32();
    if (flags & FLAG_GUID) prop.guid = r.bytesOf(16);
    if (flags & FLAG_EXTENSIONS) prop.extensions = r.u8();
    const start = r.offset;
    if (start + size > end) throw new ParseFailure(`property ${name} overruns its container`);
    prop.value = readTaggedValue(r, type, size, flags);
    r.offset = start + size;
    props.push(prop);
  }
  throw new ParseFailure('missing None terminator');
}

/** Значение свойства верхнего уровня (или поля структуры): известен размер — при сбое берём сырые байты */
function readTaggedValue(r: Reader, type: GvasType, size: number, flags: number): GvasValue {
  if (type.name === 'BoolProperty') return { kind: 'bool', value: (flags & FLAG_BOOL_TRUE) !== 0 };
  const start = r.offset;
  const end = start + size;
  if (!(flags & FLAG_BINARY)) {
    try {
      const value = readValue(r, type, end, size);
      if (r.offset === end) return value;
    } catch (err) {
      if (!(err instanceof ParseFailure)) throw err;
    }
  }
  r.offset = start;
  return { kind: 'raw', bytes: r.bytesOf(size) };
}

/** Значение без тега (внутри массива/словаря или само тело тегированного свойства) */
function readValue(r: Reader, type: GvasType, end: number, size?: number): GvasValue {
  const int = INT_SIZES[type.name];
  if (int) {
    const at = r.offset;
    r.bytesOf(int.size);
    const v = int.size === 1 ? r.view.getInt8(at) : int.size === 2 ? (int.signed ? r.view.getInt16(at, true) : r.view.getUint16(at, true)) : int.signed ? r.view.getInt32(at, true) : r.view.getUint32(at, true);
    return { kind: 'int', value: v };
  }
  switch (type.name) {
    case 'Int64Property':
    case 'UInt64Property': {
      const at = r.offset;
      r.bytesOf(8);
      return { kind: 'int64', value: type.name === 'Int64Property' ? r.view.getBigInt64(at, true) : r.view.getBigUint64(at, true) };
    }
    case 'FloatProperty': {
      const at = r.offset;
      r.bytesOf(4);
      return { kind: 'float', value: r.view.getFloat32(at, true) };
    }
    case 'DoubleProperty': {
      const at = r.offset;
      r.bytesOf(8);
      return { kind: 'double', value: r.view.getFloat64(at, true) };
    }
    case 'BoolProperty':
      return { kind: 'bool', value: r.u8() !== 0 };
    case 'ByteProperty':
      // Байт или значение перечисления (строкой). Внутри контейнера без размера считаем байтом,
      // если у типа нет параметра-перечисления.
      if (type.params.length > 0 && size !== 1) return { kind: 'string', value: r.fstring() };
      return { kind: 'byte', value: r.u8() };
    case 'StructProperty':
      return readStruct(r, type, end);
    case 'ArrayProperty': {
      const inner = param(type, 0);
      const count = r.i32();
      if (count < 0 || count > 1_000_000) throw new ParseFailure('bad array count');
      const items: GvasValue[] = [];
      for (let i = 0; i < count; i++) items.push(readValue(r, inner, end));
      return { kind: 'array', items };
    }
    case 'SetProperty': {
      const inner = param(type, 0);
      const removed = r.i32();
      if (removed !== 0) throw new ParseFailure('set with removed entries');
      const count = r.i32();
      if (count < 0 || count > 1_000_000) throw new ParseFailure('bad set count');
      const items: GvasValue[] = [];
      for (let i = 0; i < count; i++) items.push(readValue(r, inner, end));
      return { kind: 'set', removed, items };
    }
    case 'MapProperty': {
      const keyType = param(type, 0);
      const valueType = param(type, 1);
      const removed = r.i32();
      if (removed !== 0) throw new ParseFailure('map with removed entries');
      const count = r.i32();
      if (count < 0 || count > 1_000_000) throw new ParseFailure('bad map count');
      const entries: [GvasValue, GvasValue][] = [];
      for (let i = 0; i < count; i++) entries.push([readValue(r, keyType, end), readValue(r, valueType, end)]);
      return { kind: 'map', removed, entries };
    }
    default:
      if (STRING_TYPES.has(type.name)) return { kind: 'string', value: r.fstring() };
      throw new ParseFailure(`unsupported type ${type.name}`);
  }
}

function readStruct(r: Reader, type: GvasType, end: number): GvasValue {
  const structName = type.params[0]?.name ?? '';
  const native = NATIVE_STRUCTS[structName];
  if (native !== undefined) return { kind: 'raw', bytes: r.bytesOf(native) };
  return { kind: 'struct', props: readProps(r, end) };
}

function param(type: GvasType, index: number): GvasType {
  const p = type.params[index];
  if (!p) throw new ParseFailure(`${type.name} without type parameter ${index}`);
  return p;
}

// ---------------- запись ----------------

function writeType(w: Writer, type: GvasType): void {
  w.fstring(type.name);
  w.i32(type.params.length);
  for (const p of type.params) writeType(w, p);
}

function writeProps(w: Writer, props: GvasProperty[]): void {
  for (const prop of props) {
    w.fstring(prop.name);
    writeType(w, prop.type);
    const body = new Writer();
    if (prop.type.name !== 'BoolProperty') writeValue(body, prop.type, prop.value, true);
    w.i32(body.length);
    let flags = prop.flags;
    if (prop.type.name === 'BoolProperty' && prop.value.kind === 'bool') flags = prop.value.value ? flags | FLAG_BOOL_TRUE : flags & ~FLAG_BOOL_TRUE;
    w.u8(flags);
    if (flags & FLAG_ARRAY_INDEX) w.i32(prop.arrayIndex ?? 0);
    if (flags & FLAG_GUID) w.bytes(prop.guid ?? new Uint8Array(16));
    if (flags & FLAG_EXTENSIONS) w.u8(prop.extensions ?? 0);
    w.bytes(body.toBytes());
  }
  w.fstring('None');
}

function writeValue(w: Writer, type: GvasType, value: GvasValue, tagged = false): void {
  switch (value.kind) {
    case 'raw':
      return w.bytes(value.bytes);
    case 'int': {
      const int = INT_SIZES[type.name] ?? INT_SIZES.IntProperty!;
      const buf = new Uint8Array(int.size);
      const view = new DataView(buf.buffer);
      if (int.size === 1) view.setInt8(0, value.value);
      else if (int.size === 2) int.signed ? view.setInt16(0, value.value, true) : view.setUint16(0, value.value, true);
      else int.signed ? view.setInt32(0, value.value, true) : view.setUint32(0, value.value, true);
      return w.bytes(buf);
    }
    case 'int64': {
      const buf = new Uint8Array(8);
      const view = new DataView(buf.buffer);
      if (type.name === 'UInt64Property') view.setBigUint64(0, value.value, true);
      else view.setBigInt64(0, value.value, true);
      return w.bytes(buf);
    }
    case 'float': {
      const buf = new Uint8Array(4);
      new DataView(buf.buffer).setFloat32(0, value.value, true);
      return w.bytes(buf);
    }
    case 'double': {
      const buf = new Uint8Array(8);
      new DataView(buf.buffer).setFloat64(0, value.value, true);
      return w.bytes(buf);
    }
    case 'bool':
      return w.u8(value.value ? 1 : 0);
    case 'byte':
      return w.u8(value.value);
    case 'string':
      return w.fstring(value.value);
    case 'struct':
      return writeProps(w, value.props);
    case 'array':
      w.i32(value.items.length);
      for (const item of value.items) writeValue(w, param(type, 0), item);
      return;
    case 'set':
      w.i32(value.removed);
      w.i32(value.items.length);
      for (const item of value.items) writeValue(w, param(type, 0), item);
      return;
    case 'map':
      w.i32(value.removed);
      w.i32(value.entries.length);
      for (const [k, v] of value.entries) {
        writeValue(w, param(type, 0), k);
        writeValue(w, param(type, 1), v);
      }
      return;
  }
  void tagged;
}

// ---------------- публичный API ----------------

export function parseGvas(data: Uint8Array): GvasFile {
  const r = new Reader(data);
  try {
    if (decodeLatin1(data.subarray(0, 4)) !== 'GVAS') throw new SaveFormatError('не сохранение Unreal Engine (нет сигнатуры GVAS)');
    r.offset = 4;
    const saveGameVersion = r.i32();
    r.i32(); // версия пакета UE4
    if (saveGameVersion >= 3) r.i32(); // версия пакета UE5
    r.bytesOf(10); // версия движка: major, minor, patch (u16) + changelist (u32)
    r.fstring(); // ветка
    r.i32(); // формат custom versions
    const customCount = r.i32();
    if (customCount < 0 || customCount > 4096) throw new SaveFormatError('повреждённый заголовок GVAS');
    r.bytesOf(customCount * 20);
    r.fstring(); // класс SaveGame
    if (saveGameVersion >= 3) r.u8(); // UE 5.4+: дополнительный байт после класса
    const header = data.slice(0, r.offset);
    const props = readProps(r, data.byteLength);
    return { header, props, trailer: data.slice(r.offset) };
  } catch (err) {
    if (err instanceof ParseFailure) throw new SaveFormatError(`не удалось разобрать GVAS: ${err.message}`);
    throw err;
  }
}

export function serializeGvas(file: GvasFile): Uint8Array {
  const w = new Writer();
  w.bytes(file.header);
  writeProps(w, file.props);
  w.bytes(file.trailer);
  return w.toBytes();
}

/** Человекочитаемый тип: MapProperty<NameProperty, IntProperty> */
export function gvasTypeName(type: GvasType): string {
  return type.params.length ? `${type.name}<${type.params.map(gvasTypeName).join(', ')}>` : type.name;
}

export function findProp(props: GvasProperty[], name: string): GvasProperty | undefined {
  return props.find((p) => p.name === name);
}
