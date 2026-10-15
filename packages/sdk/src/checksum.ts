let crcTable: Uint32Array | undefined;

/** CRC-32 (IEEE 802.3, как в zlib). */
export function crc32(data: Uint8Array, initial = 0): number {
  crcTable ??= buildCrcTable();
  let crc = ~initial >>> 0;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return ~crc >>> 0;
}

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}

/** Сумма байтов по модулю 2^bits — частый «чексум» в старых играх. */
export function byteSum(data: Uint8Array, bits: 8 | 16 | 32 = 32): number {
  let sum = 0;
  for (const byte of data) sum += byte;
  return bits === 32 ? sum >>> 0 : sum & ((1 << bits) - 1);
}
