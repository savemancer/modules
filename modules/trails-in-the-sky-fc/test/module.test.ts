import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SaveFormatError, type SaveFile } from '@savemancer/sdk';
import { checkSchema, roundTrip } from '@savemancer/sdk/testing';
import mod from '../src/index';
import { EXP_TABLE, GROWTH } from '../src/data';

const FIXTURES = ['early.sav', 'chapter1.sav', 'full-party.sav'];
const load = (name: string): SaveFile => ({ name, data: new Uint8Array(readFileSync(new URL(`../fixtures/${name}`, import.meta.url))) });
const slotIds = (data: Uint8Array): string[] => {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const ids: string[] = [];
  for (let i = 0; i < 1024; i++) {
    const id = view.getUint16(0x24c88 + i * 4, true);
    if (id) ids.push(`i${id}`);
  }
  return ids;
};
const edit = (name: string, change: (save: ReturnType<typeof mod.parse>) => void) => {
  const original = load(name);
  const save = mod.parse([original]);
  change(save);
  const [out] = mod.serialize(save, [original]);
  return { original, out: out!, reparsed: mod.parse([out!]) };
};

describe('trails-in-the-sky-fc', () => {
  it.each(FIXTURES)('round-trips %s byte-for-byte', (name) => roundTrip(mod, [load(name)]));
  it.each(FIXTURES)('schema matches data for %s', (name) => void checkSchema(mod, [load(name)]));

  it('detects real saves and rejects other files', () => {
    for (const name of FIXTURES) expect(mod.detect?.([load(name)])).toBe(true);
    expect(mod.detect?.([{ name: 'x.sav', data: new Uint8Array(1000) }])).toBe(false);
    expect(() => mod.parse([{ name: 'x.sav', data: new Uint8Array(1000) }])).toThrow(SaveFormatError);
  });

  it('reads known values', () => {
    const save = mod.parse([load('full-party.sav')]);
    expect(save.mira).toBe(8260);
    expect(save.bp).toBe(109);
    expect(save.sepith.earth).toBe(1150);
    expect(save.chars.map((c) => c.level)).toEqual([24, 24, 15, 16, 19, 26, 23, 27]);
    expect(save.chars.filter((c) => c.inParty).map((c) => c.name)).toEqual(['Estelle', 'Joshua', 'Tita', 'Zin']);
    expect(save.unknownItems).toEqual([]);
  });

  it('writes money, sepith and stats and touches nothing else', () => {
    const { original, out, reparsed } = edit('chapter1.sav', (s) => {
      s.mira = 999_999;
      s.sepith.mirage = 9999;
      s.chars[1]!.str = 500;
    });
    expect(reparsed.mira).toBe(999_999);
    expect(reparsed.sepith.mirage).toBe(9999);
    expect(reparsed.chars[1]!.str).toBe(500);
    let changed = 0;
    for (let i = 0; i < out.data.length; i++) if (out.data[i] !== original.data[i]) changed++;
    expect(changed).toBeLessThanOrEqual(4 + 2 + 2); // три поля
  });

  it('recalculates exp, hp and stats on level change, keeping equipment bonuses', () => {
    const before = mod.parse([load('chapter1.sav')]).chars[0]!; // Estelle L12, HP 441 при базе 420
    const { reparsed } = edit('chapter1.sav', (s) => void (s.chars[0]!.level = 30));
    const c = reparsed.chars[0]!;
    const base12 = GROWTH[0]![12]!;
    const base30 = GROWTH[0]![30]!;
    expect(c.level).toBe(30);
    expect(c.exp).toBe(EXP_TABLE[30]);
    expect(c.hpMax).toBe(base30[0]! + (before.hpMax - base12[0]!));
    expect(c.str).toBe(base30[1]! + (before.str - base12[1]!));
    expect(c.hp).toBe(c.hpMax);
  });

  it('keeps values the user changed manually during a level change', () => {
    const { reparsed } = edit('chapter1.sav', (s) => {
      s.chars[0]!.level = 30;
      s.chars[0]!.str = 123;
      s.chars[0]!.exp = 5000;
    });
    expect(reparsed.chars[0]!.str).toBe(123);
    expect(reparsed.chars[0]!.exp).toBe(5000);
  });

  it('removes and adds items, keeping the order of existing ones', () => {
    const [removed, ...kept] = slotIds(load('early.sav').data);
    const { out } = edit('early.sav', (s) => {
      s.inventory[removed!] = 0;
      s.inventory.i1 = 1; // Birch Staff — новый предмет
    });
    expect(slotIds(out.data)).toEqual([...kept, 'i1']);
  });

  it('warns when hp exceeds max', () => {
    const save = mod.parse([load('chapter1.sav')]);
    save.chars[0]!.hp = 9999;
    expect(mod.validate?.(save)).toEqual([expect.objectContaining({ path: 'chars.0.hp', severity: 'warning' })]);
  });
});
