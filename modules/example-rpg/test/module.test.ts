import { describe, expect, it } from 'vitest';
import { SaveFormatError } from '@savemancer/sdk';
import { checkSchema, roundTrip } from '@savemancer/sdk/testing';
import mod from '../src/index';
import { makeSave } from './fixture';

describe('example-rpg', () => {
  it('detects its own saves', () => {
    expect(mod.detect?.([makeSave()])).toBe(true);
    expect(mod.detect?.([{ name: 'x', data: new Uint8Array(32) }])).toBe(false);
  });

  it('round-trips byte-for-byte', () => {
    roundTrip(mod, [makeSave()]);
  });

  it('has a schema that matches the data', () => {
    checkSchema(mod, [makeSave()]);
  });

  it('applies edits and keeps unknown bytes', () => {
    const original = makeSave();
    const save = mod.parse([original]);
    save.gold = 999_999;
    save.party[1]!.name = 'Schmidt';
    const [out] = mod.serialize(save, [original]);

    const reparsed = mod.parse([out!]);
    expect(reparsed.gold).toBe(999_999);
    expect(reparsed.party[1]!.name).toBe('Schmidt');
    expect(out!.data.subarray(0x28, 0x30)).toEqual(original.data.subarray(0x28, 0x30));
  });

  it('rejects corrupted files', () => {
    const save = makeSave();
    save.data.set([0x77], 0x09);
    expect(() => mod.parse([save])).toThrow(SaveFormatError);
  });

  it('warns when hp exceeds max', () => {
    const save = mod.parse([makeSave()]);
    save.party[0]!.hp = 9999;
    expect(mod.validate?.(save)).toEqual([expect.objectContaining({ path: 'party.0.hp', severity: 'warning' })]);
  });
});
