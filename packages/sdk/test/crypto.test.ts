import { describe, expect, it } from 'vitest';
import { aesCbcDecrypt, aesCbcEncrypt, aesEcbDecrypt, aesEcbEncrypt, base64Decode, base64Encode, JsonText, pkcs7Pad, pkcs7Unpad } from '../src/index';

const hex = (s: string) => new Uint8Array(s.match(/../g)!.map((b) => parseInt(b, 16)));
const toHex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

describe('AES (FIPS-197 test vectors)', () => {
  const plain = hex('00112233445566778899aabbccddeeff');
  it.each([
    ['AES-128', '000102030405060708090a0b0c0d0e0f', '69c4e0d86a7b0430d8cdb78070b4c55a'],
    ['AES-192', '000102030405060708090a0b0c0d0e0f1011121314151617', 'dda97ca4864cdfe06eaf70a0ec0d7191'],
    ['AES-256', '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f', '8ea2b7ca516745bfeafc49904b496089'],
  ])('%s encrypts and decrypts', (_, key, cipher) => {
    expect(toHex(aesEcbEncrypt(hex(key), plain))).toBe(cipher);
    expect(toHex(aesEcbDecrypt(hex(key), hex(cipher)))).toBe(toHex(plain));
  });

  it('CBC matches NIST SP 800-38A F.2.1', () => {
    const key = hex('2b7e151628aed2a6abf7158809cf4f3c');
    const iv = hex('000102030405060708090a0b0c0d0e0f');
    const pt = hex('6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e51');
    const ct = '7649abac8119b246cee98e9b12e9197d5086cb9b507219ee95db113a917678b2';
    expect(toHex(aesCbcEncrypt(key, iv, pt))).toBe(ct);
    expect(toHex(aesCbcDecrypt(key, iv, hex(ct)))).toBe(toHex(pt));
  });

  it('pads with PKCS#7', () => {
    expect(pkcs7Unpad(pkcs7Pad(new Uint8Array([1, 2, 3])))).toEqual(new Uint8Array([1, 2, 3]));
    expect(pkcs7Pad(new Uint8Array(16)).byteLength).toBe(32);
  });
});

describe('base64', () => {
  it('round-trips arbitrary bytes and matches the standard alphabet', () => {
    const bytes = new Uint8Array(256).map((_, i) => i);
    expect(base64Decode(base64Encode(bytes))).toEqual(bytes);
    expect(base64Encode(new TextEncoder().encode('Man'))).toBe('TWFu');
    expect(base64Encode(new TextEncoder().encode('Ma'))).toBe('TWE=');
    expect(new TextDecoder().decode(base64Decode('TWFu\nTWE='.replace('\n', '')))).toBe('ManMa');
  });
});

describe('JsonText', () => {
  const text = '{"playerData":{"geo":120,"speed":1.0,"name":"Knight","flags":[true,false]},"x": 2.50}';
  it('keeps unchanged text byte-for-byte', () => {
    expect(new JsonText(text).toString()).toBe(text);
  });
  it('replaces only edited values', () => {
    const doc = new JsonText(text);
    doc.set(['playerData', 'geo'], 99999);
    doc.set(['playerData', 'flags', 1], true);
    doc.set(['playerData', 'speed'], 1); // то же значение — текст 1.0 не меняется
    expect(doc.toString()).toBe('{"playerData":{"geo":99999,"speed":1.0,"name":"Knight","flags":[true,true]},"x": 2.50}');
    expect(doc.get(['playerData', 'name'])).toBe('Knight');
  });
});
