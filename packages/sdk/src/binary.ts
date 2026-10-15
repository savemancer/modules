import { SaveFormatError } from './types';

export type Endian = 'le' | 'be';
export type TextEncoding = 'ascii' | 'utf-8' | 'utf-16le';

/** Последовательное чтение бинарных данных с проверкой границ. */
export class BinaryReader {
  readonly view: DataView;
  offset = 0;

  constructor(readonly bytes: Uint8Array, readonly endian: Endian = 'le') {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get length(): number {
    return this.bytes.byteLength;
  }

  get remaining(): number {
    return this.length - this.offset;
  }

  seek(offset: number): this {
    if (offset < 0 || offset > this.length) throw new SaveFormatError(`seek out of range: ${offset}`);
    this.offset = offset;
    return this;
  }

  skip(count: number): this {
    return this.seek(this.offset + count);
  }

  private take(size: number): number {
    if (this.offset + size > this.length) {
      throw new SaveFormatError(`unexpected end of file at 0x${this.offset.toString(16)} (+${size})`);
    }
    const at = this.offset;
    this.offset += size;
    return at;
  }

  u8(): number { return this.view.getUint8(this.take(1)); }
  i8(): number { return this.view.getInt8(this.take(1)); }
  u16(): number { return this.view.getUint16(this.take(2), this.endian === 'le'); }
  i16(): number { return this.view.getInt16(this.take(2), this.endian === 'le'); }
  u32(): number { return this.view.getUint32(this.take(4), this.endian === 'le'); }
  i32(): number { return this.view.getInt32(this.take(4), this.endian === 'le'); }
  f32(): number { return this.view.getFloat32(this.take(4), this.endian === 'le'); }
  f64(): number { return this.view.getFloat64(this.take(8), this.endian === 'le'); }
  bool(): boolean { return this.u8() !== 0; }

  bytesOf(count: number): Uint8Array {
    const at = this.take(count);
    return this.bytes.slice(at, at + count);
  }

  /** Строка фиксированной длины; обрезается по первому нулевому символу. */
  fixedString(size: number, encoding: TextEncoding = 'ascii'): string {
    return decodeText(this.bytesOf(size), encoding);
  }

  magic(expected: string): void {
    const actual = this.fixedString(expected.length);
    if (actual !== expected) throw new SaveFormatError(`bad magic: expected "${expected}", got "${actual}"`);
  }
}

/**
 * Запись поверх существующего буфера. Типичный сценарий — патч копии оригинального
 * сейва, чтобы неизвестные байты остались как есть.
 */
export class BinaryWriter {
  readonly view: DataView;
  offset = 0;

  constructor(readonly bytes: Uint8Array, readonly endian: Endian = 'le') {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  seek(offset: number): this {
    if (offset < 0 || offset > this.bytes.byteLength) throw new RangeError(`seek out of range: ${offset}`);
    this.offset = offset;
    return this;
  }

  skip(count: number): this {
    return this.seek(this.offset + count);
  }

  private take(size: number): number {
    if (this.offset + size > this.bytes.byteLength) throw new RangeError(`write past end at 0x${this.offset.toString(16)}`);
    const at = this.offset;
    this.offset += size;
    return at;
  }

  u8(v: number): this { this.view.setUint8(this.take(1), checkInt(v, 0, 0xff)); return this; }
  i8(v: number): this { this.view.setInt8(this.take(1), checkInt(v, -0x80, 0x7f)); return this; }
  u16(v: number): this { this.view.setUint16(this.take(2), checkInt(v, 0, 0xffff), this.endian === 'le'); return this; }
  i16(v: number): this { this.view.setInt16(this.take(2), checkInt(v, -0x8000, 0x7fff), this.endian === 'le'); return this; }
  u32(v: number): this { this.view.setUint32(this.take(4), checkInt(v, 0, 0xffffffff), this.endian === 'le'); return this; }
  i32(v: number): this { this.view.setInt32(this.take(4), checkInt(v, -0x80000000, 0x7fffffff), this.endian === 'le'); return this; }
  f32(v: number): this { this.view.setFloat32(this.take(4), v, this.endian === 'le'); return this; }
  f64(v: number): this { this.view.setFloat64(this.take(8), v, this.endian === 'le'); return this; }
  bool(v: boolean): this { return this.u8(v ? 1 : 0); }

  write(data: Uint8Array): this {
    this.bytes.set(data, this.take(data.byteLength));
    return this;
  }

  /** Строка фиксированной длины, остаток заполняется нулями. */
  fixedString(value: string, size: number, encoding: TextEncoding = 'ascii'): this {
    const encoded = encodeText(value, encoding);
    if (encoded.byteLength > size) throw new RangeError(`string "${value}" exceeds ${size} bytes`);
    const padded = new Uint8Array(size);
    padded.set(encoded);
    return this.write(padded);
  }
}

function checkInt(v: number, min: number, max: number): number {
  if (!Number.isInteger(v) || v < min || v > max) throw new RangeError(`value ${v} out of range [${min}, ${max}]`);
  return v;
}

export function decodeText(bytes: Uint8Array, encoding: TextEncoding): string {
  const text = new TextDecoder(encoding === 'ascii' ? 'utf-8' : encoding).decode(bytes);
  const nul = text.indexOf('\0');
  return nul === -1 ? text : text.slice(0, nul);
}

export function encodeText(value: string, encoding: TextEncoding): Uint8Array {
  switch (encoding) {
    case 'ascii':
      if (!/^[\x00-\x7f]*$/.test(value)) throw new RangeError(`non-ASCII characters in "${value}"`);
      return new TextEncoder().encode(value);
    case 'utf-8':
      return new TextEncoder().encode(value);
    case 'utf-16le': {
      const out = new Uint8Array(value.length * 2);
      const view = new DataView(out.buffer);
      for (let i = 0; i < value.length; i++) view.setUint16(i * 2, value.charCodeAt(i), true);
      return out;
    }
  }
}
