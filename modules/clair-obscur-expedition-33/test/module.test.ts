import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findProp, parseGvas, serializeGvas, type GvasValue, type SaveFile } from '@savemancer/sdk';
import { checkSchema, roundTrip } from '@savemancer/sdk/testing';
import mod from '../src/index';

const FIXTURES = ['act1-level12.sav', 'maelle-joined.sav', 'early-two-heroes.sav'];
const load = (name: string): SaveFile => ({ name: 'EXPEDITION_0.sav', data: new Uint8Array(readFileSync(new URL(`../fixtures/${name}`, import.meta.url))) });
const edit = (name: string, change: (s: ReturnType<typeof mod.parse>) => void) => {
  const original = load(name);
  const save = mod.parse([original]);
  change(save);
  const [out] = mod.serialize(save, [original]);
  return { original, out: out!, reparsed: mod.parse([out!]) };
};
const inventoryIds = (data: Uint8Array) => {
  const inv = findProp(parseGvas(data).props, 'InventoryItems')!.value as Extract<GvasValue, { kind: 'map' }>;
  return inv.entries.map(([k, v]) => `${(k as { value: string }).value}=${(v as { value: number }).value}`);
};

describe('GVAS (SDK) на сейвах Clair Obscur', () => {
  it.each(FIXTURES)('parse → serialize даёт исходные байты: %s', (name) => {
    const data = load(name).data;
    expect(serializeGvas(parseGvas(data))).toEqual(data);
  });
});

describe('clair-obscur-expedition-33', () => {
  it.each(FIXTURES)('round-trips %s byte-for-byte', (name) => roundTrip(mod, [load(name)]));
  it.each(FIXTURES)('schema matches data for %s', (name) => void checkSchema(mod, [load(name)]));

  it('detects its saves and rejects other files', () => {
    expect(mod.detect?.([load('act1-level12.sav')])).toBe(true);
    expect(mod.detect?.([{ name: 'x.sav', data: new Uint8Array(4096) }])).toBe(false);
  });

  it('reads known values', () => {
    const save = mod.parse([load('act1-level12.sav')]);
    expect(save.gold).toBe(10_007_719);
    expect(save.heroes.map((h) => `${h.name} L${h.level}`)).toEqual(['Gustave L12', 'Lune L12', 'Maelle L11']);
    expect(save.heroes[0]!.attributes).toEqual({ a0: 4, a1: 15, a3: 3, a4: 4, a5: 4 });
    expect(save.resources.UpgradeMaterial_Level1).toBeGreaterThanOrEqual(0);
  });

  it('changes gold in place without touching other bytes', () => {
    const { original, out, reparsed } = edit('act1-level12.sav', (s) => void (s.gold = 123_456));
    expect(reparsed.gold).toBe(123_456);
    expect(out.data.length).toBe(original.data.length);
    let changed = 0;
    for (let i = 0; i < out.data.length; i++) if (out.data[i] !== original.data[i]) changed++;
    expect(changed).toBeLessThanOrEqual(4);
  });

  it('resets experience on level change unless edited, and writes attributes', () => {
    const { reparsed } = edit('act1-level12.sav', (s) => {
      s.heroes[0]!.level = 20;
      s.heroes[1]!.level = 15;
      s.heroes[1]!.experience = 100;
      s.heroes[2]!.attributes.a1 = 20;
    });
    expect(reparsed.heroes[0]).toMatchObject({ level: 20, experience: 0 });
    expect(reparsed.heroes[1]).toMatchObject({ level: 15, experience: 100 });
    expect(reparsed.heroes[2]!.attributes.a1).toBe(20);
  });

  it('adds, changes and removes resources keeping the rest of the inventory', () => {
    const before = inventoryIds(load('act1-level12.sav').data);
    const save = mod.parse([load('act1-level12.sav')]);
    const present = Object.entries(save.resources).find(([, n]) => n > 0)![0];
    const absent = Object.entries(save.resources).find(([, n]) => n === 0)?.[0];
    const { out, reparsed } = edit('act1-level12.sav', (s) => {
      s.resources[present] = 0;
      if (absent) s.resources[absent] = 7;
    });
    const after = inventoryIds(out.data);
    expect(after).toEqual([...before.filter((e) => !e.startsWith(`${present}=`)), ...(absent ? [`${absent}=7`] : [])]);
    expect(reparsed.resources[present]).toBe(0);
  });

  it('warns when more attribute points are assigned than the level gives', () => {
    const save = mod.parse([load('act1-level12.sav')]);
    save.heroes[0]!.attributes.a1 = 99;
    expect(mod.validate?.(save)).toEqual([expect.objectContaining({ path: 'heroes.0.level', severity: 'warning' })]);
  });
});
