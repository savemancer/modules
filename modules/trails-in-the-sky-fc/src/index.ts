import { BinaryReader, BinaryWriter, defineModule, SaveFormatError, type Field, type SaveFile } from '@savemancer/sdk';
import { EXP_TABLE, GROWTH, ITEMS, MAX_LEVEL, type ItemCategory } from './data';

// Раскладка файла сохранения (Steam-версия, ed6_win.exe). Контрольной суммы нет.
const SAVE_SIZE = 212160;
const OFF_LINEUP = 0x23e38; // 8 × u32: id персонажа или 0xFF
const OFF_CHARS = 0x23e58; // 8 записей по 52 байта
const CHAR_SIZE = 52;
const OFF_INVENTORY = 0x24c88; // 1024 × (u16 id, u16 количество), без дыр
const INV_SLOTS = 1024;
const OFF_MIRA = 0x25c88; // u32
const OFF_BP = 0x25c8c; // u16
const OFF_SEPITH = 0x25c90; // 7 × u32

const CHAR_NAMES = ['Estelle', 'Joshua', 'Scherazard', 'Olivier', 'Kloe', 'Agate', 'Tita', 'Zin'];
const SEPITH = ['earth', 'water', 'fire', 'wind', 'time', 'space', 'mirage'] as const;
const SEPITH_LABELS: Record<Sepith, string> = {
  earth: 'Земля', water: 'Вода', fire: 'Огонь', wind: 'Ветер', time: 'Время', space: 'Пространство', mirage: 'Мираж',
};
const CATEGORY_LABELS: Record<ItemCategory, string> = {
  weapon: 'Оружие', armor: 'Броня и обувь', accessory: 'Аксессуары', food: 'Еда', medicine: 'Лекарства',
  book: 'Книги', quartz: 'Кварц', ingredient: 'Ингредиенты', key: 'Сюжетные предметы — осторожно, могут сломать прохождение',
};

type Sepith = (typeof SEPITH)[number];

// Поля записи персонажа: смещение в записи и размер
const CHAR_FIELDS = [
  ['level', 0, 2], ['hpMax', 2, 2], ['hp', 4, 2], ['epMax', 6, 2], ['ep', 8, 2], ['cp', 10, 2], ['exp', 12, 4],
  ['str', 16, 2], ['def', 18, 2], ['ats', 20, 2], ['adf', 22, 2], ['dex', 24, 2], ['agl', 26, 2], ['mov', 28, 2],
  ['spd', 30, 2], ['cpMax', 32, 2],
] as const;
type CharKey = (typeof CHAR_FIELDS)[number][0];
// Порядок совпадает с GROWTH: [HP, STR, DEF, ATS, ADF, DEX, AGL, MOV, SPD]
const GROWTH_KEYS = ['hpMax', 'str', 'def', 'ats', 'adf', 'dex', 'agl', 'mov', 'spd'] as const;

export type Character = Record<CharKey, number> & { name: string; inParty: boolean };

export interface SkySave {
  mira: number;
  bp: number;
  sepith: Record<Sepith, number>;
  chars: Character[];
  /** Количество каждого известного предмета, ключ — `i<id>`; 0 — предмета нет */
  inventory: Record<string, number>;
  /** Предметы, которых нет в таблице: сохраняются как есть */
  unknownItems: { id: number; count: number }[];
}

const ITEM_BY_ID = new Map(ITEMS.map((item) => [item[0], item]));
const itemKey = (id: number) => `i${id}`;

function single(files: SaveFile[]): SaveFile {
  const file = files[0];
  if (files.length !== 1 || !file) throw new SaveFormatError('ожидается один файл сохранения (.sav)');
  if (file.data.byteLength !== SAVE_SIZE) throw new SaveFormatError(`размер ${file.data.byteLength} байт, ожидается ${SAVE_SIZE}`);
  return file;
}

function readInventory(r: BinaryReader): { id: number; count: number }[] {
  r.seek(OFF_INVENTORY);
  const slots: { id: number; count: number }[] = [];
  for (let i = 0; i < INV_SLOTS; i++) {
    const id = r.u16();
    const count = r.u16();
    if (id) slots.push({ id, count });
  }
  return slots;
}

function parse(files: SaveFile[]): SkySave {
  const r = new BinaryReader(single(files).data);

  const lineup = new Set<number>();
  r.seek(OFF_LINEUP);
  for (let i = 0; i < 8; i++) {
    const id = r.u32();
    if (id < 8) lineup.add(id);
    else if (id !== 0xff) throw new SaveFormatError(`неожиданный состав отряда: ${id}`);
  }

  const chars = CHAR_NAMES.map((name, i) => {
    const c = { name, inParty: lineup.has(i) } as Character;
    for (const [key, offset, size] of CHAR_FIELDS) {
      r.seek(OFF_CHARS + i * CHAR_SIZE + offset);
      c[key] = size === 4 ? r.u32() : r.u16();
    }
    if (c.level < 1 || c.level > 99) throw new SaveFormatError(`неправдоподобный уровень ${name}: ${c.level}`);
    return c;
  });

  const inventory: Record<string, number> = {};
  for (const [id] of ITEMS) inventory[itemKey(id)] = 0;
  const unknownItems: SkySave['unknownItems'] = [];
  for (const slot of readInventory(r)) {
    if (ITEM_BY_ID.has(slot.id)) inventory[itemKey(slot.id)] = slot.count;
    else unknownItems.push(slot);
  }

  r.seek(OFF_SEPITH);
  const sepith = Object.fromEntries(SEPITH.map((s) => [s, r.u32()])) as Record<Sepith, number>;
  return { mira: r.seek(OFF_MIRA).u32(), bp: r.seek(OFF_BP).u16(), sepith, chars, inventory, unknownItems };
}

/**
 * Смена уровня: EXP ставится на порог уровня, HP и характеристики — по таблице роста игры
 * с сохранением бонусов экипировки. Значения, которые пользователь поменял сам, не трогаем.
 */
function applyLevelChange(c: Character, before: Character, charIndex: number): void {
  if (c.level === before.level) return;
  if (c.exp === before.exp && c.level <= MAX_LEVEL) c.exp = EXP_TABLE[c.level]!;

  const growth = GROWTH[charIndex]!;
  const from = growth[before.level];
  const to = growth[c.level];
  if (from && to) {
    GROWTH_KEYS.forEach((key, i) => {
      if (c[key] === before[key]) c[key] = Math.max(0, Math.min(0xffff, to[i]! + (before[key] - from[i]!)));
    });
  }
  if (c.hp === before.hp) c.hp = c.hpMax;
  if (c.ep === before.ep) c.ep = c.epMax;
}

function serialize(save: SkySave, original: SaveFile[]): SaveFile[] {
  const source = single(original);
  const before = parse(original);
  const out = source.data.slice();
  const w = new BinaryWriter(out);

  w.seek(OFF_MIRA).u32(save.mira);
  w.seek(OFF_BP).u16(save.bp);
  w.seek(OFF_SEPITH);
  for (const s of SEPITH) w.u32(save.sepith[s]);

  save.chars.forEach((c, i) => {
    const updated = { ...c };
    applyLevelChange(updated, before.chars[i]!, i);
    for (const [key, offset, size] of CHAR_FIELDS) {
      w.seek(OFF_CHARS + i * CHAR_SIZE + offset);
      if (size === 4) w.u32(updated[key]);
      else w.u16(updated[key]);
    }
  });

  // Инвентарь: прежние предметы в прежнем порядке, новые — в конец по возрастанию id
  const slots: { id: number; count: number }[] = [];
  const seen = new Set<number>();
  for (const slot of readInventory(new BinaryReader(source.data))) {
    seen.add(slot.id);
    const count = ITEM_BY_ID.has(slot.id) ? (save.inventory[itemKey(slot.id)] ?? 0) : slot.count;
    if (count > 0) slots.push({ id: slot.id, count });
  }
  for (const [id] of ITEMS) {
    const count = save.inventory[itemKey(id)] ?? 0;
    if (!seen.has(id) && count > 0) slots.push({ id, count });
  }
  if (slots.length > INV_SLOTS) throw new RangeError(`слишком много разных предметов: ${slots.length} > ${INV_SLOTS}`);
  w.seek(OFF_INVENTORY).write(new Uint8Array(INV_SLOTS * 4));
  w.seek(OFF_INVENTORY);
  for (const slot of slots) w.u16(slot.id).u16(slot.count);

  return [{ name: source.name, data: out }];
}

function characterFields(i: number): Field[] {
  const p = (key: CharKey) => `chars.${i}.${key}`;
  const value = (key: CharKey, label: string, max = 9999): Field => ({ kind: 'number', path: p(key), label, min: 0, max });
  // Игра пересчитывает максимумы и характеристики при загрузке (уровень + экипировка), значения в файле — кэш.
  const derived = (key: CharKey, label: string): Field => ({ kind: 'number', path: p(key), label, readonly: true });
  return [
    {
      kind: 'number', path: p('level'), label: 'Уровень', min: 1, max: MAX_LEVEL,
      hint: 'EXP встанет на порог уровня, HP — на ожидаемый максимум (если вы не меняли их вручную)',
    },
    value('exp', 'EXP', 9_999_999),
    value('hp', 'HP'),
    value('ep', 'EP'),
    value('cp', 'CP', 200),
    {
      kind: 'group', label: 'Характеристики — игра пересчитывает сама по уровню и экипировке', collapsed: true,
      fields: [
        derived('hpMax', 'HP макс.'), derived('epMax', 'EP макс.'), derived('cpMax', 'CP макс.'),
        derived('str', 'STR'), derived('def', 'DEF'), derived('ats', 'ATS'), derived('adf', 'ADF'),
        derived('dex', 'DEX'), derived('agl', 'AGL'), derived('mov', 'MOV'), derived('spd', 'SPD'),
      ],
    },
  ];
}

function inventoryGroups(): Field[] {
  return (Object.keys(CATEGORY_LABELS) as ItemCategory[]).map((cat) => ({
    kind: 'group',
    label: CATEGORY_LABELS[cat],
    collapsed: true,
    fields: ITEMS.filter((item) => item[3] === cat).map(([id, name, max]): Field => ({
      kind: 'number', path: `inventory.${itemKey(id)}`, label: name, min: 0, max,
    })),
  }));
}

export default defineModule<SkySave>({
  detect(files) {
    const file = files[0];
    if (files.length !== 1 || !file || file.data.byteLength !== SAVE_SIZE) return false;
    const view = new DataView(file.data.buffer, file.data.byteOffset, file.data.byteLength);
    for (let i = 0; i < 8; i++) {
      const id = view.getUint32(OFF_LINEUP + i * 4, true);
      if (id >= 8 && id !== 0xff) return false;
    }
    return true;
  },

  parse,

  schema(save) {
    return {
      tabs: [
        {
          id: 'general',
          label: 'Общее',
          fields: [
            { kind: 'number', path: 'mira', label: 'Мира', min: 0, max: 999_999 },
            { kind: 'number', path: 'bp', label: 'BP (очки брейсера)', min: 0, max: 9999 },
            {
              kind: 'group', label: 'Сепиты',
              fields: SEPITH.map((s): Field => ({ kind: 'number', path: `sepith.${s}`, label: SEPITH_LABELS[s], min: 0, max: 9999 })),
            },
          ],
        },
        {
          id: 'chars',
          label: 'Персонажи',
          fields: save.chars.map((c, i): Field => ({
            kind: 'group',
            label: c.inParty ? `${c.name} · в отряде` : c.name,
            collapsed: !c.inParty,
            fields: characterFields(i),
          })),
        },
        { id: 'items', label: 'Предметы', fields: inventoryGroups() },
      ],
    };
  },

  validate(save) {
    return save.chars.flatMap((c, i) => [
      ...(c.hp > c.hpMax ? [{ path: `chars.${i}.hp`, message: 'HP больше максимума', severity: 'warning' as const }] : []),
      ...(c.ep > c.epMax ? [{ path: `chars.${i}.ep`, message: 'EP больше максимума', severity: 'warning' as const }] : []),
      ...(c.cp > c.cpMax && c.cpMax > 0 ? [{ path: `chars.${i}.cp`, message: 'CP больше максимума', severity: 'warning' as const }] : []),
    ]);
  },

  serialize,
});
