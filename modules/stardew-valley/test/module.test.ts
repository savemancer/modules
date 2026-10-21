import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SaveFormatError, type SaveFile } from '@savemancer/sdk';
import { checkSchema, roundTrip } from '@savemancer/sdk/testing';
import mod from '../src/index';

const load = (): SaveFile => ({ name: 'Synthetic_123456789', data: new Uint8Array(readFileSync(new URL('../fixtures/Synthetic_123456789', import.meta.url))) });
const text = (data: Uint8Array) => new TextDecoder().decode(data);

describe('stardew-valley', () => {
  it('reads only direct children of <player>', () => {
    const save = mod.parse([load()]);
    expect(save.name).toBe('Синтетик');
    expect(save.numbers).toEqual({ money: 1500, qiGems: 3, clubCoins: 0, maxHealth: 100, maxStamina: 270 });
    expect(save.skills).toEqual([
      { level: 2, xp: 400 }, { level: 1, xp: 120 }, { level: 3, xp: 800 }, { level: 1, xp: 150 }, { level: 0, xp: 40 },
    ]);
  });

  it('round-trips byte-for-byte', () => roundTrip(mod, [load()]));
  it('has a schema that matches the data', () => void checkSchema(mod, [load()]));

  it('edits money and skills without touching nested tags', () => {
    const original = load();
    const save = mod.parse([original]);
    save.numbers.money = 1_000_000;
    save.skills[3]!.level = 10; // шахтёрство: опыт встанет на 15000
    save.skills[0]!.xp = 999;
    const [out] = mod.serialize(save, [original]);
    const before = text(original.data);
    expect(text(out!.data)).toBe(
      before
        .replace('<money>1500</money>', '<money>1000000</money>')
        .replace('<miningLevel>1</miningLevel>', '<miningLevel>10</miningLevel>')
        .replace('<int>150</int>', '<int>15000</int>')
        .replace('<int>400</int>', '<int>999</int>'),
    );
    expect(text(out!.data)).toContain('<money>1</money>'); // у предмета
    expect(text(out!.data)).toContain('<money>777</money>'); // у локации
  });

  it('explains wrong files', () => {
    const info = { name: 'SaveGameInfo', data: new TextEncoder().encode('<?xml version="1.0"?><Farmer><name>x</name></Farmer>') };
    expect(() => mod.parse([info])).toThrow(/SaveGameInfo/);
    expect(() => mod.parse([{ name: 'x', data: new Uint8Array([0x78, 0x9c, 1, 2]) }])).toThrow(SaveFormatError);
    expect(mod.detect?.([info])).toBe(false);
  });
});
