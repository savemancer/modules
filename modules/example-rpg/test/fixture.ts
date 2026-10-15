import { BinaryWriter, crc32, type SaveFile } from '@savemancer/sdk';

/**
 * Синтетический сейв для тестов. В реальном модуле кладите настоящие сейвы
 * в fixtures/ (без персональных данных) и читайте их через fs.
 */
export function makeSave(): SaveFile {
  const party = [
    { name: 'Estelle', level: 12, classId: 0, hp: 420, maxHp: 450, mp: 30 },
    { name: 'Joshua', level: 12, classId: 2, hp: 380, maxHp: 380, mp: 45 },
  ];
  const data = new Uint8Array(0x10 + party.length * 32 + 4);
  const w = new BinaryWriter(data);
  w.fixedString('XRPG', 4).u16(1).u16(party.length).u32(1500).u32(36_000);
  party.forEach((m, i) => {
    w.fixedString(m.name, 16).u8(m.level).u8(m.classId).u16(m.hp).u16(m.maxHp).u16(m.mp);
    w.write(new Uint8Array([0xde, 0xad, 0xbe, 0xef, i, 0, 0, 0x7f])); // «неизвестные» байты
  });
  w.u32(crc32(data.subarray(0, data.byteLength - 4)));
  return { name: 'slot01.xsav', data };
}
