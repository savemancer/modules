/**
 * Публичный контракт между модулем игры и сайтом Savemancer.
 * Всё, что модуль возвращает, должно быть structured-clonable (plain data):
 * модуль выполняется в Web Worker, данные пересекают границу postMessage.
 */

export const SDK_VERSION = '0.1.0';

export type Platform = 'pc' | 'switch' | 'ps4' | 'ps5' | 'xbox' | 'mobile' | 'other';

/** Один файл сохранения. Некоторые игры хранят сейв в нескольких файлах. */
export interface SaveFile {
  name: string;
  data: Uint8Array;
}

/** Содержимое module.json — метаданные, которые сайт показывает до загрузки кода модуля. */
export interface ModuleManifest {
  /** kebab-case, совпадает с именем папки: "trails-in-the-sky-fc" */
  id: string;
  /** Отображаемое название игры */
  game: string;
  /** semver модуля */
  version: string;
  /** Совместимая версия SDK (semver range) */
  sdk: string;
  authors: string[];
  status: 'experimental' | 'beta' | 'stable';
  platforms: Platform[];
  /** Какие файлы ожидает модуль (glob по имени файла) */
  files: { pattern: string; description?: string; optional?: boolean }[];
  /** Подсказки пользователю, где искать сейв на каждой платформе */
  saveLocations?: Partial<Record<Platform, string[]>>;
  /** Ссылки на исследования формата, если есть */
  references?: string[];
}

/** Путь к значению внутри данных модуля: "party.0.hp" */
export type DataPath = string;

interface FieldBase {
  label: string;
  hint?: string;
  readonly?: boolean;
}

export interface NumberField extends FieldBase {
  kind: 'number';
  path: DataPath;
  min?: number;
  max?: number;
  /** По умолчанию true — большинство полей в сейвах целочисленные */
  integer?: boolean;
}

export interface TextField extends FieldBase {
  kind: 'text';
  path: DataPath;
  /** Максимальная длина в байтах после кодирования — модуль сам знает свою кодировку */
  maxLength?: number;
}

export interface ToggleField extends FieldBase {
  kind: 'toggle';
  path: DataPath;
}

export interface SelectField extends FieldBase {
  kind: 'select';
  path: DataPath;
  options: { value: number | string; label: string }[];
}

export interface GroupField extends FieldBase {
  kind: 'group';
  fields: Field[];
  collapsed?: boolean;
}

/** Массив однотипных записей (персонажи, предметы). Пути в fields — относительно элемента. */
export interface ListField extends FieldBase {
  kind: 'list';
  path: DataPath;
  /** Шаблон заголовка элемента: "{name} (Lv {level})" */
  itemLabel: string;
  fields: Field[];
}

export type Field = NumberField | TextField | ToggleField | SelectField | GroupField | ListField;

export interface EditorTab {
  id: string;
  label: string;
  fields: Field[];
}

export interface EditorSchema {
  tabs: EditorTab[];
}

export interface ValidationIssue {
  path: DataPath;
  message: string;
  severity: 'error' | 'warning';
}

/**
 * Модуль игры. Чистые функции: без сети, DOM, таймеров и глобального состояния.
 * T — модель данных сейва (plain object).
 */
export interface GameModule<T = unknown> {
  /** Быстрая проверка, что файлы — сейв этой игры (magic, размер). */
  detect?(files: SaveFile[]): boolean;
  /** Байты → модель. Бросает SaveFormatError, если формат не распознан. */
  parse(files: SaveFile[]): T;
  /** Описание UI редактора. Может зависеть от данных (например, число слотов). */
  schema(data: T): EditorSchema;
  /** Доп. проверки перед сохранением, сверх min/max из схемы. */
  validate?(data: T): ValidationIssue[];
  /**
   * Модель → байты. original — исходные файлы: рекомендуется патчить их копию,
   * чтобы сохранить неизвестные байты нетронутыми.
   */
  serialize(data: T, original: SaveFile[]): SaveFile[];
}

export class SaveFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SaveFormatError';
  }
}

export function defineModule<T>(module: GameModule<T>): GameModule<T> {
  return module;
}
