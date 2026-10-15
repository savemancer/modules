import { BinaryReader, BinaryWriter, crc32, defineModule, SaveFormatError, type SaveFile } from '@savemancer/sdk';

const MAGIC = 'XRPG';
const HEADER_SIZE = 0x10;
const MEMBER_SIZE = 32;
const NAME_SIZE = 16;

const CLASSES = [
  { value: 0, label: 'Воин' },
  { value: 1, label: 'Маг' },
  { value: 2, label: 'Вор' },
  { value: 3, label: 'Жрец' },
];

export interface Member {
  name: string;
  level: number;
  classId: number;
  hp: number;
  maxHp: number;
  mp: number;
}

export interface ExampleSave {
  gold: number;
  playtimeSeconds: number;
  party: Member[];
}

function single(files: SaveFile[]): SaveFile {
  const file = files[0];
  if (files.length !== 1 || !file) throw new SaveFormatError('ожидается ровно один файл .xsav');
  return file;
}

export default defineModule<ExampleSave>({
  detect(files) {
    const file = files[0];
    return file !== undefined && file.data.byteLength >= HEADER_SIZE + 4 && new TextDecoder().decode(file.data.subarray(0, 4)) === MAGIC;
  },

  parse(files) {
    const { data } = single(files);
    const r = new BinaryReader(data);
    r.magic(MAGIC);
    const version = r.u16();
    if (version !== 1) throw new SaveFormatError(`неподдерживаемая версия формата: ${version}`);
    const count = r.u16();
    if (data.byteLength !== HEADER_SIZE + count * MEMBER_SIZE + 4) throw new SaveFormatError('размер файла не совпадает с заголовком');

    const stored = new DataView(data.buffer, data.byteOffset + data.byteLength - 4, 4).getUint32(0, true);
    if (crc32(data.subarray(0, data.byteLength - 4)) !== stored) throw new SaveFormatError('неверная контрольная сумма — файл повреждён?');

    const gold = r.u32();
    const playtimeSeconds = r.u32();
    const party: Member[] = [];
    for (let i = 0; i < count; i++) {
      party.push({ name: r.fixedString(NAME_SIZE), level: r.u8(), classId: r.u8(), hp: r.u16(), maxHp: r.u16(), mp: r.u16() });
      r.skip(8);
    }
    return { gold, playtimeSeconds, party };
  },

  schema(save) {
    return {
      tabs: [
        {
          id: 'general',
          label: 'Общее',
          fields: [
            { kind: 'number', path: 'gold', label: 'Золото', min: 0, max: 9_999_999 },
            { kind: 'number', path: 'playtimeSeconds', label: 'Время игры (сек)', min: 0, max: 0xffffffff },
          ],
        },
        {
          id: 'party',
          label: `Партия (${save.party.length})`,
          fields: [
            {
              kind: 'list',
              path: 'party',
              label: 'Персонажи',
              itemLabel: '{name} — Lv {level}',
              fields: [
                { kind: 'text', path: 'name', label: 'Имя', maxLength: NAME_SIZE },
                { kind: 'number', path: 'level', label: 'Уровень', min: 1, max: 99 },
                { kind: 'select', path: 'classId', label: 'Класс', options: CLASSES },
                { kind: 'number', path: 'hp', label: 'HP', min: 0, max: 9999 },
                { kind: 'number', path: 'maxHp', label: 'Max HP', min: 1, max: 9999 },
                { kind: 'number', path: 'mp', label: 'MP', min: 0, max: 999 },
              ],
            },
          ],
        },
      ],
    };
  },

  validate(save) {
    return save.party.flatMap((m, i) =>
      m.hp > m.maxHp ? [{ path: `party.${i}.hp`, message: 'HP больше максимального', severity: 'warning' as const }] : [],
    );
  },

  serialize(save, original) {
    const source = single(original);
    const out = source.data.slice();
    const w = new BinaryWriter(out);
    w.seek(0x08).u32(save.gold).u32(save.playtimeSeconds);
    save.party.forEach((m, i) => {
      w.seek(HEADER_SIZE + i * MEMBER_SIZE).fixedString(m.name, NAME_SIZE).u8(m.level).u8(m.classId).u16(m.hp).u16(m.maxHp).u16(m.mp);
    });
    w.seek(out.byteLength - 4).u32(crc32(out.subarray(0, out.byteLength - 4)));
    return [{ name: source.name, data: out }];
  },
});
