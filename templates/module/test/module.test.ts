import { describe, it } from 'vitest';
import { checkSchema, roundTrip } from '@savemancer/sdk/testing';
import mod from '../src/index';

// TODO: положите реальный сейв в fixtures/ и загрузите его:
//   const data = new Uint8Array(readFileSync(new URL('../fixtures/slot1.sav', import.meta.url)));
const sample = { name: 'slot1.sav', data: new Uint8Array(16) };

describe('__ID__', () => {
  it('round-trips byte-for-byte', () => roundTrip(mod, [sample]));
  it('has a schema that matches the data', () => checkSchema(mod, [sample]));
});
