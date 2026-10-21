import {
  aesEcbDecrypt,
  aesEcbEncrypt,
  base64Decode,
  base64Encode,
  defineModule,
  JsonText,
  pkcs7Pad,
  pkcs7Unpad,
  SaveFormatError,
  type Field,
  type SaveFile,
} from '@savemancer/sdk';

// user*.dat: заголовок .NET BinaryFormatter + строка base64(AES-256-ECB(JSON)) + 0x0B.
// Ключ публично известен и зашит в игру; шифрование защищает от случайной порчи, а не от модов.
const BF_HEADER = [0, 1, 0, 0, 0, 255, 255, 255, 255, 1, 0, 0, 0, 0, 0, 0, 0, 6, 1, 0, 0, 0];
const BF_END = 0x0b;
const KEY = new TextEncoder().encode('UKu52ePUBwetZ9wNX88o54dnfKRu0T1l');

interface NumberSpec {
  key: string;
  label: string;
  min: number;
  max: number;
  hint?: string;
}

const GENERAL: NumberSpec[] = [
  { key: 'geo', label: 'Гео', min: 0, max: 9_999_999 },
  { key: 'ore', label: 'Бледная руда', min: 0, max: 6 },
  { key: 'simpleKeys', label: 'Простые ключи', min: 0, max: 4 },
  { key: 'rancidEggs', label: 'Тухлые яйца', min: 0, max: 80 },
  { key: 'dreamOrbs', label: 'Эссенция', min: 0, max: 9999 },
];
const VITALS: NumberSpec[] = [
  { key: 'maxHealthBase', label: 'Маски здоровья', min: 5, max: 9, hint: 'Текущие и максимальные маски обновятся вместе с базой' },
  { key: 'heartPieces', label: 'Осколки масок (до следующей)', min: 0, max: 3 },
  { key: 'maxMP', label: 'Запас души', min: 99, max: 99 + 33 * 3, hint: '99 + 33 за каждый полный сосуд' },
  { key: 'vesselFragments', label: 'Фрагменты сосудов (до следующего)', min: 0, max: 2 },
  { key: 'charmSlots', label: 'Ячейки амулетов', min: 3, max: 11 },
  { key: 'nailSmithUpgrades', label: 'Улучшения гвоздя', min: 0, max: 4, hint: 'Урон гвоздя пересчитается: 5 + 4 за улучшение' },
];
/** Номера амулетов в сейве (gotCharm_N) → название в игре */
const CHARMS = [
  'Gathering Swarm', 'Wayward Compass', 'Grubsong', 'Stalwart Shell', 'Baldur Shell', 'Fury of the Fallen', 'Quick Focus',
  'Lifeblood Heart', 'Lifeblood Core', "Defender's Crest", 'Flukenest', 'Thorns of Agony', 'Mark of Pride', 'Steady Body',
  'Heavy Blow', 'Sharp Shadow', 'Spore Shroom', 'Longnail', 'Shaman Stone', 'Soul Catcher', 'Soul Eater', 'Glowing Womb',
  'Fragile Heart', 'Fragile Greed', 'Fragile Strength', "Nailmaster's Glory", "Joni's Blessing", 'Shape of Unn', 'Hiveblood',
  'Dream Wielder', 'Dashmaster', 'Quick Slash', 'Spell Twister', 'Deep Focus', "Grubberfly's Elegy", 'Kingsoul / Void Heart',
  'Sprintmaster', 'Dreamshield', 'Weaversong', 'Grimmchild / Carefree Melody',
];

export interface HollowSave {
  numbers: Record<string, number>;
  charms: Record<string, boolean>;
}

function single(files: SaveFile[]): SaveFile {
  const file = files[0];
  if (files.length !== 1 || !file) throw new SaveFormatError('ожидается один файл user*.dat');
  return file;
}

function decode(data: Uint8Array): JsonText {
  if (data.byteLength < BF_HEADER.length + 2 || BF_HEADER.some((b, i) => data[i] !== b) || data[data.byteLength - 1] !== BF_END) {
    throw new SaveFormatError('не похоже на сохранение Hollow Knight (нет заголовка BinaryFormatter)');
  }
  let at = BF_HEADER.length;
  let length = 0;
  for (let shift = 0; ; shift += 7) {
    const b = data[at++]!;
    length |= (b & 0x7f) << shift;
    if (!(b & 0x80)) break;
    if (shift > 28) throw new SaveFormatError('повреждённая длина строки');
  }
  if (at + length + 1 !== data.byteLength) throw new SaveFormatError('длина данных не совпадает с заголовком');
  const encrypted = base64Decode(new TextDecoder('latin1').decode(data.subarray(at, at + length)));
  let json: string;
  try {
    json = new TextDecoder('utf-8', { fatal: true }).decode(pkcs7Unpad(aesEcbDecrypt(KEY, encrypted)));
  } catch {
    throw new SaveFormatError('не удалось расшифровать — это сохранение с Switch/консоли или повреждённый файл?');
  }
  const doc = new JsonText(json);
  if (typeof doc.get(['playerData']) !== 'object') throw new SaveFormatError('в сохранении нет playerData');
  return doc;
}

function encode(doc: JsonText): Uint8Array {
  const b64 = new TextEncoder().encode(base64Encode(aesEcbEncrypt(KEY, pkcs7Pad(new TextEncoder().encode(doc.toString())))));
  const length: number[] = [];
  for (let n = b64.byteLength; ; ) {
    if (n >> 7) {
      length.push((n & 0x7f) | 0x80);
      n >>= 7;
    } else {
      length.push(n);
      break;
    }
  }
  const out = new Uint8Array(BF_HEADER.length + length.length + b64.byteLength + 1);
  out.set(BF_HEADER);
  out.set(length, BF_HEADER.length);
  out.set(b64, BF_HEADER.length + length.length);
  out[out.byteLength - 1] = BF_END;
  return out;
}

const pd = (key: string) => ['playerData', key];

function parse(files: SaveFile[]): HollowSave {
  const doc = decode(single(files).data);
  const numbers: Record<string, number> = {};
  for (const spec of [...GENERAL, ...VITALS]) {
    const v = doc.get(pd(spec.key));
    if (typeof v === 'number') numbers[spec.key] = v;
  }
  const charms: Record<string, boolean> = {};
  CHARMS.forEach((_, i) => {
    const v = doc.get(pd(`gotCharm_${i + 1}`));
    if (typeof v === 'boolean') charms[`c${i + 1}`] = v;
  });
  return { numbers, charms };
}

function serialize(save: HollowSave, original: SaveFile[]): SaveFile[] {
  const source = single(original);
  const doc = decode(source.data);
  const num = (key: string) => doc.get(pd(key)) as number;

  for (const [key, value] of Object.entries(save.numbers)) doc.set(pd(key), value);

  // Связанные поля: максимум масок и текущее здоровье следуют за базой, урон — за улучшениями гвоздя
  const healthDelta = (save.numbers.maxHealthBase ?? num('maxHealthBase')) - num('maxHealthBase');
  if (healthDelta !== 0 && typeof num('maxHealth') === 'number') {
    const maxHealth = num('maxHealth') + healthDelta;
    doc.set(pd('maxHealth'), maxHealth);
    if (typeof num('health') === 'number') doc.set(pd('health'), maxHealth);
  }
  if (save.numbers.nailSmithUpgrades !== undefined && typeof num('nailDamage') === 'number') {
    doc.set(pd('nailDamage'), 5 + 4 * save.numbers.nailSmithUpgrades);
  }
  for (const [key, got] of Object.entries(save.charms)) doc.set(pd(`gotCharm_${key.slice(1)}`), got);

  // Без изменений возвращаем исходные байты — не перешифровываем то, что не трогали
  return [{ name: source.name, data: doc.changed ? encode(doc) : source.data }];
}

const numberFields = (specs: NumberSpec[], save: HollowSave): Field[] =>
  specs.filter((s) => s.key in save.numbers).map((s) => ({ kind: 'number', path: `numbers.${s.key}`, label: s.label, min: s.min, max: s.max, hint: s.hint }));

export default defineModule<HollowSave>({
  detect(files) {
    const file = files[0];
    return files.length === 1 && file !== undefined && BF_HEADER.every((b, i) => file.data[i] === b);
  },

  parse,

  schema(save) {
    return {
      tabs: [
        { id: 'general', label: 'Ресурсы', fields: numberFields(GENERAL, save) },
        { id: 'vitals', label: 'Здоровье, душа, гвоздь', fields: numberFields(VITALS, save) },
        {
          id: 'charms',
          label: 'Амулеты',
          fields: CHARMS.flatMap((name, i): Field[] => (`c${i + 1}` in save.charms ? [{ kind: 'toggle', path: `charms.c${i + 1}`, label: name, hint: `gotCharm_${i + 1}` }] : [])),
        },
      ],
    };
  },

  serialize,
});
