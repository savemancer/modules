import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SaveFormatError, type SaveFile } from '@savemancer/sdk';
import { checkSchema, roundTrip } from '@savemancer/sdk/testing';
import mod from '../src/index';

// Фикстура собрана независимым энкодером на node:crypto (см. README) — проверяет AES и обёртку SDK
const load = (): SaveFile => ({ name: 'user1.dat', data: new Uint8Array(readFileSync(new URL('../fixtures/synthetic-user1.dat', import.meta.url))) });

describe('hollow-knight', () => {
  it('decrypts the independently encoded save', () => {
    const save = mod.parse([load()]);
    expect(save.numbers).toMatchObject({ geo: 1234, maxHealthBase: 5, nailSmithUpgrades: 1, charmSlots: 4 });
    expect(Object.keys(save.charms)).toHaveLength(40);
    expect(save.charms.c1).toBe(true);
    expect(save.charms.c40).toBe(false);
  });

  it('round-trips byte-for-byte', () => roundTrip(mod, [load()]));
  it('has a schema that matches the data', () => void checkSchema(mod, [load()]));

  it('re-encrypts edits and keeps untouched JSON text intact', () => {
    const original = load();
    const save = mod.parse([original]);
    save.numbers.geo = 99_999;
    save.numbers.maxHealthBase = 9;
    save.numbers.nailSmithUpgrades = 4;
    save.charms.c36 = true;
    const [out] = mod.serialize(save, [original]);
    const reparsed = mod.parse([out!]);
    expect(reparsed.numbers).toMatchObject({ geo: 99_999, maxHealthBase: 9, nailSmithUpgrades: 4 });
    expect(reparsed.charms.c36).toBe(true);
    expect(out!.data.subarray(0, 22)).toEqual(original.data.subarray(0, 22));
    expect(out!.data[out!.data.byteLength - 1]).toBe(0x0b);
  });

  it('rejects other files', () => {
    expect(mod.detect?.([{ name: 'x', data: new Uint8Array(64) }])).toBe(false);
    expect(() => mod.parse([{ name: 'x', data: new Uint8Array(64) }])).toThrow(SaveFormatError);
  });
});
