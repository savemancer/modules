import {
  defineModule,
  findProp,
  parseGvas,
  SaveFormatError,
  serializeGvas,
  type Field,
  type GvasFile,
  type GvasProperty,
  type GvasValue,
  type SaveFile,
} from '@savemancer/sdk';

// Сохранение — GVAS (Unreal Engine 5.4). Поля структур имеют суффикс вида _49_97AB…, ищем по префиксу.
const SAVE_CLASS_MARKER = 'BP_SaveGameObject';

/** Внутреннее имя персонажа → имя в игре */
const HERO_NAMES: Record<string, string> = { Frey: 'Gustave' };

/** ECharacterAttribute::NewEnumeratorN → атрибут. Порядок сверен по сейвам частично — см. README. */
const ATTRIBUTES = [
  { key: 'a0', enumValue: 'ECharacterAttribute::NewEnumerator0', label: 'Живучесть (Vitality)' },
  { key: 'a1', enumValue: 'ECharacterAttribute::NewEnumerator1', label: 'Сила (Might)' },
  { key: 'a3', enumValue: 'ECharacterAttribute::NewEnumerator3', label: 'Ловкость (Agility)' },
  { key: 'a4', enumValue: 'ECharacterAttribute::NewEnumerator4', label: 'Защита (Defense)' },
  { key: 'a5', enumValue: 'ECharacterAttribute::NewEnumerator5', label: 'Удача (Luck)' },
] as const;
/** Сверено по сейвам: на каждом уровне игра даёт 3 очка атрибутов */
const ATTRIBUTE_POINTS_PER_LEVEL = 3;
const MAX_LEVEL = 99;

/** Накапливаемые ресурсы: только их показываем в редакторе. Оружие, пиктосы, косметику и квестовое не трогаем. */
const RESOURCE_ID = /^(Consumable|UpgradeMaterial|ChromaPack|PartyHeal|FestivalToken)|(Shard|Tint)$/;
/** Ресурсы, которые можно добавить, даже если их ещё нет: ID встречались в реальных сейвах */
const ADDABLE_RESOURCES = ['UpgradeMaterial_Level1', 'UpgradeMaterial_Level2', 'Consumable_LuminaPoint', 'Consumable_Respec', 'ConsumableUpgradeMaterial_Health'];
/** Названия из игры для ID, которые не очевидны */
const RESOURCE_LABELS: Record<string, string> = {
  UpgradeMaterial_Level1: 'Chroma Catalyst',
  UpgradeMaterial_Level2: 'Polished Chroma Catalyst',
  Consumable_LuminaPoint: 'Colour of Lumina',
  Consumable_Respec: 'Recoat',
  Consumable_Health_Level0: 'Healing Tint',
  Consumable_Energy_Level0: 'Energy Tint',
  Consumable_Revive_Level0: 'Revive Tint',
};

export interface Hero {
  key: string;
  name: string;
  level: number;
  experience: number;
  attributes: Record<string, number>;
}

export interface E33Save {
  gold: number;
  heroes: Hero[];
  resources: Record<string, number>;
}

function single(files: SaveFile[]): SaveFile {
  const file = files[0];
  if (files.length !== 1 || !file) throw new SaveFormatError('ожидается один файл EXPEDITION_*.sav');
  return file;
}

const fieldName = (name: string) => name.replace(/_\d+_[0-9A-F]{32}$/, '');
const field = (props: GvasProperty[], name: string) => props.find((p) => fieldName(p.name) === name);

function intOf(prop: GvasProperty | undefined, what: string): number {
  if (prop?.value.kind !== 'int') throw new SaveFormatError(`не найдено поле ${what}`);
  return prop.value.value;
}

function mapOf(prop: GvasProperty | undefined, what: string): Extract<GvasValue, { kind: 'map' }> {
  if (prop?.value.kind !== 'map') throw new SaveFormatError(`не найден словарь ${what}`);
  return prop.value;
}

const keyString = (v: GvasValue) => (v.kind === 'string' ? v.value : '');

function heroStructs(g: GvasFile): { key: string; props: GvasProperty[] }[] {
  return mapOf(findProp(g.props, 'CharactersCollection'), 'CharactersCollection').entries.flatMap(([k, v]) =>
    v.kind === 'struct' ? [{ key: keyString(k), props: v.props }] : [],
  );
}

function humanize(id: string): string {
  return RESOURCE_LABELS[id] ?? id.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\s+/g, ' ').trim();
}

function parse(files: SaveFile[]): E33Save {
  const g = parseGvas(single(files).data);
  const heroes = heroStructs(g).map(({ key, props }) => {
    const attrs = mapOf(field(props, 'AssignedAttributePoints'), 'AssignedAttributePoints');
    const attributes: Record<string, number> = {};
    for (const a of ATTRIBUTES) {
      const entry = attrs.entries.find(([k]) => keyString(k) === a.enumValue);
      if (entry && entry[1].kind === 'int') attributes[a.key] = entry[1].value;
    }
    return {
      key,
      name: HERO_NAMES[key] ?? key,
      level: intOf(field(props, 'CurrentLevel'), 'CurrentLevel'),
      experience: intOf(field(props, 'CurrentExperience'), 'CurrentExperience'),
      attributes,
    };
  });

  const resources: Record<string, number> = {};
  for (const id of ADDABLE_RESOURCES) resources[id] = 0;
  const inventory = findProp(g.props, 'InventoryItems');
  if (inventory) {
    for (const [k, v] of mapOf(inventory, 'InventoryItems').entries) {
      const id = keyString(k);
      if (RESOURCE_ID.test(id) && v.kind === 'int') resources[id] = v.value;
    }
  }
  return { gold: intOf(findProp(g.props, 'Gold'), 'Gold'), heroes, resources };
}

function setInt(prop: GvasProperty | undefined, value: number): void {
  if (prop?.value.kind === 'int') prop.value.value = value;
}

function serialize(save: E33Save, original: SaveFile[]): SaveFile[] {
  const source = single(original);
  const g = parseGvas(source.data);
  const before = parse(original);

  setInt(findProp(g.props, 'Gold'), save.gold);

  const structs = heroStructs(g);
  for (const hero of save.heroes) {
    const target = structs.find((s) => s.key === hero.key);
    const old = before.heroes.find((h) => h.key === hero.key);
    if (!target || !old) continue;
    // Опыт хранится как прогресс внутри уровня: при смене уровня начинаем уровень с нуля
    const experience = hero.level !== old.level && hero.experience === old.experience ? 0 : hero.experience;
    setInt(field(target.props, 'CurrentLevel'), hero.level);
    setInt(field(target.props, 'CurrentExperience'), experience);
    const attrs = mapOf(field(target.props, 'AssignedAttributePoints'), 'AssignedAttributePoints');
    for (const a of ATTRIBUTES) {
      const entry = attrs.entries.find(([k]) => keyString(k) === a.enumValue);
      const value = hero.attributes[a.key];
      if (entry && entry[1].kind === 'int' && value !== undefined) entry[1].value = value;
    }
  }

  // Инвентарь: прежние записи в прежнем порядке, обнулённые ресурсы удаляем, новые — в конец
  const inventory = findProp(g.props, 'InventoryItems');
  if (inventory) {
    const map = mapOf(inventory, 'InventoryItems');
    const seen = new Set<string>();
    map.entries = map.entries.filter(([k, v]) => {
      const id = keyString(k);
      seen.add(id);
      if (!(id in save.resources) || v.kind !== 'int') return true;
      v.value = save.resources[id]!;
      return v.value > 0;
    });
    for (const [id, count] of Object.entries(save.resources)) {
      if (!seen.has(id) && count > 0) map.entries.push([{ kind: 'string', value: id }, { kind: 'int', value: count }]);
    }
  } else if (Object.values(save.resources).some((n) => n > 0)) {
    throw new RangeError('в этом сохранении ещё нет инвентаря — добавлять предметы нельзя');
  }

  return [{ name: source.name, data: serializeGvas(g) }];
}

function heroFields(i: number): Field[] {
  return [
    {
      kind: 'number', path: `heroes.${i}.level`, label: 'Уровень', min: 1, max: MAX_LEVEL,
      hint: `За каждый уровень игра даёт ${ATTRIBUTE_POINTS_PER_LEVEL} очка атрибутов — новые очки распределите в игре. Опыт начнётся с нуля.`,
    },
    { kind: 'number', path: `heroes.${i}.experience`, label: 'Опыт в текущем уровне', min: 0, max: 10_000_000 },
    {
      kind: 'group', label: 'Распределённые очки атрибутов',
      fields: ATTRIBUTES.map((a): Field => ({ kind: 'number', path: `heroes.${i}.attributes.${a.key}`, label: a.label, min: 0, max: 99 })),
    },
  ];
}

export default defineModule<E33Save>({
  detect(files) {
    const file = files[0];
    if (files.length !== 1 || !file || file.data.byteLength < 64) return false;
    const head = new TextDecoder('latin1').decode(file.data.subarray(0, Math.min(file.data.byteLength, 4096)));
    return head.startsWith('GVAS') && head.includes(SAVE_CLASS_MARKER);
  },

  parse,

  schema(save) {
    const resourceIds = Object.keys(save.resources).sort((a, b) => humanize(a).localeCompare(humanize(b)));
    return {
      tabs: [
        { id: 'general', label: 'Общее', fields: [{ kind: 'number', path: 'gold', label: 'Золото', min: 0, max: 99_999_999 }] },
        {
          id: 'heroes',
          label: 'Персонажи',
          fields: save.heroes.map((h, i): Field => ({ kind: 'group', label: h.name, fields: heroFields(i) })),
        },
        {
          id: 'items',
          label: 'Материалы и расходники',
          fields: resourceIds.map((id): Field => ({ kind: 'number', path: `resources.${id}`, label: humanize(id), hint: id, min: 0, max: 999 })),
        },
      ],
    };
  },

  validate(save) {
    return save.heroes.flatMap((h, i) => {
      const spent = Object.values(h.attributes).reduce((s, n) => s + n, 0);
      const available = h.level * ATTRIBUTE_POINTS_PER_LEVEL;
      return spent > available
        ? [{ path: `heroes.${i}.level`, message: `Распределено ${spent} очков атрибутов, а уровень даёт ${available}`, severity: 'warning' as const }]
        : [];
    });
  },

  serialize,
});
