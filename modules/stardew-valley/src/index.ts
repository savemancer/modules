import { defineModule, SaveFormatError, type Field, type SaveFile } from '@savemancer/sdk';

// Основной файл фермы — XML (XmlSerializer). Правим только текст прямых потомков <SaveGame><player>,
// остальной документ сохраняется побайтно. Сжатые сейвы (zlib) пока не поддерживаются.

const NUMBERS = [
  { key: 'money', label: 'Деньги', max: 99_999_999 },
  { key: 'qiGems', label: 'Qi-самоцветы', max: 9999 },
  { key: 'clubCoins', label: 'Монеты казино', max: 99_999_999 },
  { key: 'maxHealth', label: 'Макс. здоровье', max: 999 },
  { key: 'maxStamina', label: 'Макс. энергия', max: 999 },
];
/** Порядок как в experiencePoints: 0 земледелие, 1 рыбалка, 2 собирательство, 3 шахтёрство, 4 бой */
const SKILLS = [
  { level: 'farmingLevel', label: 'Земледелие' },
  { level: 'fishingLevel', label: 'Рыбалка' },
  { level: 'foragingLevel', label: 'Собирательство' },
  { level: 'miningLevel', label: 'Шахтёрство' },
  { level: 'combatLevel', label: 'Бой' },
];
/** Опыт, с которого начинается уровень 1…10 */
const XP_FOR_LEVEL = [0, 100, 380, 770, 1300, 2150, 3300, 4800, 6900, 10000, 15000];

interface Span {
  start: number;
  end: number;
}

interface PlayerDoc {
  text: string;
  /** Текст прямых потомков <player> без вложенных тегов: имя → позиция */
  fields: Map<string, Span>;
  /** <experiencePoints><int>…</int>×6 */
  xp: Span[];
}

export interface StardewSave {
  name: string;
  numbers: Record<string, number>;
  skills: { level: number; xp: number }[];
}

function single(files: SaveFile[]): SaveFile {
  const file = files[0];
  if (files.length !== 1 || !file) throw new SaveFormatError('ожидается один основной файл фермы');
  return file;
}

const TAG = /<(\/?)([A-Za-z_][\w:.-]*)([^>]*?)(\/?)>/g;

function load(data: Uint8Array): PlayerDoc {
  if (data[0] === 0x78 || (data[0] === 0x1f && data[1] === 0x8b)) throw new SaveFormatError('сжатые сейвы пока не поддерживаются');
  const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(data);
  if (!/<SaveGame[\s>]/.test(text.slice(0, 2000))) {
    throw new SaveFormatError(text.includes('<Farmer') ? 'это SaveGameInfo — нужен основной файл фермы с именем папки' : 'не похоже на сохранение Stardew Valley');
  }
  const fields = new Map<string, Span>();
  const xp: Span[] = [];

  // Ищем <player> — прямой потомок <SaveGame> — и разбираем его детей с учётом глубины
  TAG.lastIndex = 0;
  let depth = 0;
  let inPlayer = false;
  let playerDepth = 0;
  let open: { name: string; contentStart: number; hasChildren: boolean }[] = [];
  for (let m = TAG.exec(text); m; m = TAG.exec(text)) {
    const [, closing, name, , selfClosing] = m;
    if (text[m.index + 1] === '?' || text[m.index + 1] === '!') continue;
    if (closing) {
      const el = open.pop();
      depth--;
      if (inPlayer && el) {
        const rel = depth - playerDepth; // 0 — сам <player>, 1 — его дети
        if (rel === 1 && !el.hasChildren) fields.set(name!, { start: el.contentStart, end: m.index });
        if (rel === 2 && name === 'int' && open[open.length - 1]?.name === 'experiencePoints') xp.push({ start: el.contentStart, end: m.index });
        if (rel === 0 && name === 'player') break;
      }
      continue;
    }
    if (open.length) open[open.length - 1]!.hasChildren = true;
    if (selfClosing) continue;
    if (!inPlayer && name === 'player' && depth === 1) {
      inPlayer = true;
      playerDepth = depth;
      open = [];
    }
    open.push({ name: name!, contentStart: m.index + m[0].length, hasChildren: false });
    depth++;
  }
  if (!inPlayer) throw new SaveFormatError('в сохранении нет <player>');
  return { text, fields, xp };
}

const read = (doc: PlayerDoc, span: Span) => doc.text.slice(span.start, span.end);
const readInt = (doc: PlayerDoc, key: string): number | undefined => {
  const span = doc.fields.get(key);
  if (!span) return undefined;
  const v = Number(read(doc, span));
  return Number.isInteger(v) ? v : undefined;
};

function parse(files: SaveFile[]): StardewSave {
  const doc = load(single(files).data);
  const numbers: Record<string, number> = {};
  for (const n of NUMBERS) {
    const v = readInt(doc, n.key);
    if (v !== undefined) numbers[n.key] = v;
  }
  const skills = SKILLS.map((s, i) => ({ level: readInt(doc, s.level) ?? 0, xp: doc.xp[i] ? Number(read(doc, doc.xp[i]!)) : 0 }));
  const nameSpan = doc.fields.get('name');
  return { name: nameSpan ? read(doc, nameSpan) : '', numbers, skills };
}

function serialize(save: StardewSave, original: SaveFile[]): SaveFile[] {
  const source = single(original);
  const doc = load(source.data);
  const before = parse(original);
  const edits: { span: Span; text: string }[] = [];
  const put = (span: Span | undefined, value: number) => {
    if (span && read(doc, span) !== String(value)) edits.push({ span, text: String(value) });
  };

  for (const [key, value] of Object.entries(save.numbers)) put(doc.fields.get(key), value);
  save.skills.forEach((skill, i) => {
    const old = before.skills[i]!;
    // Смена уровня без ручной правки опыта — опыт на порог уровня, чтобы игра не «откатила» прогресс
    const xp = skill.level !== old.level && skill.xp === old.xp ? XP_FOR_LEVEL[skill.level]! : skill.xp;
    put(doc.fields.get(SKILLS[i]!.level), skill.level);
    put(doc.xp[i], xp);
  });

  if (edits.length === 0) return [{ name: source.name, data: source.data }];
  let text = doc.text;
  for (const e of edits.sort((a, b) => b.span.start - a.span.start)) text = text.slice(0, e.span.start) + e.text + text.slice(e.span.end);
  return [{ name: source.name, data: new TextEncoder().encode(text) }];
}

export default defineModule<StardewSave>({
  detect(files) {
    try {
      load(single(files).data);
      return true;
    } catch {
      return false;
    }
  },

  parse,

  schema(save) {
    return {
      tabs: [
        {
          id: 'general',
          label: save.name ? `Фермер: ${save.name}` : 'Фермер',
          fields: NUMBERS.filter((n) => n.key in save.numbers).map((n): Field => ({ kind: 'number', path: `numbers.${n.key}`, label: n.label, min: 0, max: n.max })),
        },
        {
          id: 'skills',
          label: 'Навыки',
          fields: SKILLS.map((s, i): Field => ({
            kind: 'group',
            label: s.label,
            fields: [
              { kind: 'number', path: `skills.${i}.level`, label: 'Уровень', min: 0, max: 10, hint: 'Профессии за 5 и 10 уровни игра выдаёт только при обычном повышении — при прыжке через них выбора не будет' },
              { kind: 'number', path: `skills.${i}.xp`, label: 'Опыт', min: 0, max: 100_000 },
            ],
          })),
        },
      ],
    };
  },

  serialize,
});
