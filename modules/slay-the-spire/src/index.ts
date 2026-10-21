import { base64Decode, base64Encode, defineModule, JsonText, SaveFormatError, type Field, type SaveFile } from '@savemancer/sdk';

// *.autosave: base64(JSON XOR "key"). Старые версии и моды иногда пишут JSON как есть — поддерживаем оба варианта.
const XOR_KEY = new TextEncoder().encode('key');

const NUMBERS = [
  { key: 'gold', label: 'Золото', max: 99_999 },
  { key: 'current_health', label: 'Здоровье', max: 999 },
  { key: 'max_health', label: 'Макс. здоровье', max: 999 },
];
const KEYS = [
  { key: 'has_emerald_key', label: 'Изумрудный ключ' },
  { key: 'has_ruby_key', label: 'Рубиновый ключ' },
  { key: 'has_sapphire_key', label: 'Сапфировый ключ' },
];

export interface SpireCard {
  id: string;
  upgrades: number;
}

export interface SpireSave {
  numbers: Record<string, number>;
  keys: Record<string, boolean>;
  cards: SpireCard[];
}

interface Decoded {
  doc: JsonText;
  encoded: boolean;
}

function single(files: SaveFile[]): SaveFile {
  const file = files[0];
  if (files.length !== 1 || !file) throw new SaveFormatError('ожидается один файл *.autosave');
  return file;
}

const xor = (bytes: Uint8Array) => bytes.map((b, i) => b ^ XOR_KEY[i % XOR_KEY.length]!);

function decode(data: Uint8Array): Decoded {
  const text = new TextDecoder().decode(data).trim();
  let json: string;
  let encoded = true;
  if (text.startsWith('{')) {
    json = text;
    encoded = false;
  } else {
    try {
      json = new TextDecoder('utf-8', { fatal: true }).decode(xor(base64Decode(text)));
    } catch {
      throw new SaveFormatError('не похоже на сохранение Slay the Spire');
    }
  }
  let doc: JsonText;
  try {
    doc = new JsonText(json);
  } catch {
    throw new SaveFormatError('не похоже на сохранение Slay the Spire');
  }
  if (typeof doc.get(['gold']) !== 'number' || !Array.isArray(doc.get(['cards']))) {
    throw new SaveFormatError('в файле нет данных забега (gold, cards)');
  }
  return { doc, encoded };
}

function parse(files: SaveFile[]): SpireSave {
  const { doc } = decode(single(files).data);
  const numbers: Record<string, number> = {};
  for (const n of NUMBERS) {
    const v = doc.get([n.key]);
    if (typeof v === 'number') numbers[n.key] = v;
  }
  const keys: Record<string, boolean> = {};
  for (const k of KEYS) {
    const v = doc.get([k.key]);
    if (typeof v === 'boolean') keys[k.key] = v;
  }
  const cards = (doc.get(['cards']) as { id?: unknown; upgrades?: unknown }[]).map((c) => ({
    id: typeof c.id === 'string' ? c.id : '?',
    upgrades: typeof c.upgrades === 'number' ? c.upgrades : 0,
  }));
  return { numbers, keys, cards };
}

function serialize(save: SpireSave, original: SaveFile[]): SaveFile[] {
  const source = single(original);
  const { doc, encoded } = decode(source.data);
  for (const [key, value] of Object.entries(save.numbers)) doc.set([key], value);
  for (const [key, value] of Object.entries(save.keys)) doc.set([key], value);
  save.cards.forEach((card, i) => {
    if (doc.has(['cards', i, 'upgrades'])) doc.set(['cards', i, 'upgrades'], card.upgrades);
  });
  if (!doc.changed) return [{ name: source.name, data: source.data }];
  const json = new TextEncoder().encode(doc.toString());
  const data = encoded ? new TextEncoder().encode(base64Encode(xor(json))) : json;
  return [{ name: source.name, data }];
}

export default defineModule<SpireSave>({
  detect(files) {
    try {
      decode(single(files).data);
      return true;
    } catch {
      return false;
    }
  },

  parse,

  schema(save) {
    const general: Field[] = [
      ...NUMBERS.filter((n) => n.key in save.numbers).map((n): Field => ({ kind: 'number', path: `numbers.${n.key}`, label: n.label, min: 0, max: n.max })),
      ...KEYS.filter((k) => k.key in save.keys).map((k): Field => ({ kind: 'toggle', path: `keys.${k.key}`, label: k.label })),
    ];
    return {
      tabs: [
        { id: 'run', label: 'Забег', fields: general },
        {
          id: 'deck',
          label: `Колода (${save.cards.length})`,
          fields: [
            {
              kind: 'list',
              path: 'cards',
              label: 'Карты',
              itemLabel: '{id} +{upgrades}',
              fields: [{ kind: 'number', path: 'upgrades', label: 'Улучшения', min: 0, max: 99, hint: 'Обычные карты улучшаются один раз; Searing Blow — сколько угодно' }],
            },
          ],
        },
      ],
    };
  },

  validate(save) {
    const hp = save.numbers.current_health;
    const max = save.numbers.max_health;
    return hp !== undefined && max !== undefined && hp > max ? [{ path: 'numbers.current_health', message: 'Здоровье больше максимума', severity: 'warning' as const }] : [];
  },

  serialize,
});
