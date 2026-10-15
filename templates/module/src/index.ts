import { BinaryReader, BinaryWriter, defineModule, SaveFormatError } from '@savemancer/sdk';

export interface Save {
  money: number;
}

const MONEY_OFFSET = 0x00; // TODO: реальный оффсет

export default defineModule<Save>({
  detect(files) {
    // TODO: проверить magic/размер, чтобы не принимать чужие файлы
    return files.length === 1;
  },

  parse(files) {
    const file = files[0];
    if (!file) throw new SaveFormatError('файл не передан');
    const r = new BinaryReader(file.data);
    return { money: r.seek(MONEY_OFFSET).u32() };
  },

  schema() {
    return {
      tabs: [{ id: 'general', label: 'Общее', fields: [{ kind: 'number', path: 'money', label: 'Деньги', min: 0 }] }],
    };
  },

  serialize(save, original) {
    const file = original[0]!;
    const out = file.data.slice();
    new BinaryWriter(out).seek(MONEY_OFFSET).u32(save.money);
    // TODO: пересчитать контрольную сумму, если она есть
    return [{ name: file.name, data: out }];
  },
});
