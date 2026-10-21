import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { base64Decode, type SaveFile } from '@savemancer/sdk';
import { checkSchema, roundTrip } from '@savemancer/sdk/testing';
import mod from '../src/index';

const load = (): SaveFile => ({ name: 'IRONCLAD.autosave', data: new Uint8Array(readFileSync(new URL('../fixtures/synthetic-IRONCLAD.autosave', import.meta.url))) });
const plain = (data: Uint8Array) => {
  const key = new TextEncoder().encode('key');
  return new TextDecoder().decode(base64Decode(new TextDecoder().decode(data)).map((b, i) => b ^ key[i % 3]!));
};

describe('slay-the-spire', () => {
  it('decodes the run', () => {
    const save = mod.parse([load()]);
    expect(save.numbers).toEqual({ gold: 199, current_health: 62, max_health: 80 });
    expect(save.keys).toEqual({ has_emerald_key: false, has_ruby_key: false, has_sapphire_key: true });
    expect(save.cards.map((c) => `${c.id}+${c.upgrades}`)).toEqual(['Strike_R+0', 'Bash+1', 'Searing Blow+0']);
  });

  it('round-trips byte-for-byte', () => roundTrip(mod, [load()]));
  it('has a schema that matches the data', () => void checkSchema(mod, [load()]));

  it('edits values and keeps the rest of the JSON text', () => {
    const original = load();
    const save = mod.parse([original]);
    save.numbers.gold = 999;
    save.keys.has_ruby_key = true;
    save.cards[2]!.upgrades = 10;
    const [out] = mod.serialize(save, [original]);
    const before = plain(original.data);
    const after = plain(out!.data);
    expect(after).toBe(before.replace('"gold":199', '"gold":999').replace('"has_ruby_key":false', '"has_ruby_key":true').replace('{"upgrades":0,"misc":0,"id":"Searing Blow"}', '{"upgrades":10,"misc":0,"id":"Searing Blow"}'));
    expect(after).toContain('"floor_num":12.0');
  });

  it('accepts plain JSON saves and writes them back as plain JSON', () => {
    const json = plain(load().data);
    const file = { name: 'IRONCLAD.autosave', data: new TextEncoder().encode(json) };
    const save = mod.parse([file]);
    save.numbers.gold = 5;
    const [out] = mod.serialize(save, [file]);
    expect(new TextDecoder().decode(out!.data)).toBe(json.replace('"gold":199', '"gold":5'));
  });

  it('rejects other files', () => {
    expect(mod.detect?.([{ name: 'x', data: new TextEncoder().encode('hello world') }])).toBe(false);
  });
});
