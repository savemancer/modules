/**
 * Синхронный AES (128/192/256) для сейвов, зашифрованных публично известными ключами
 * (Hollow Knight, Terraria и т. п.). Web Crypto не подходит: он асинхронный и не умеет ECB.
 * Реализация по FIPS-197, проверена тестовыми векторами стандарта.
 */

const SBOX = new Uint8Array(256);
const INV_SBOX = new Uint8Array(256);

(() => {
  // S-box: обратный элемент в GF(2^8) + аффинное преобразование
  let p = 1;
  let q = 1;
  do {
    p = p ^ ((p << 1) & 0xff) ^ (p & 0x80 ? 0x1b : 0);
    q ^= q << 1;
    q ^= q << 2;
    q ^= q << 4;
    q &= 0xff;
    if (q & 0x80) q ^= 0x09;
    const x = q ^ rotl8(q, 1) ^ rotl8(q, 2) ^ rotl8(q, 3) ^ rotl8(q, 4) ^ 0x63;
    SBOX[p] = x;
    INV_SBOX[x] = p;
  } while (p !== 1);
  SBOX[0] = 0x63;
  INV_SBOX[0x63] = 0;
})();

function rotl8(x: number, shift: number): number {
  return ((x << shift) | (x >> (8 - shift))) & 0xff;
}

function xtime(x: number): number {
  return ((x << 1) ^ (x & 0x80 ? 0x1b : 0)) & 0xff;
}

function mul(a: number, b: number): number {
  let r = 0;
  while (b) {
    if (b & 1) r ^= a;
    a = xtime(a);
    b >>= 1;
  }
  return r;
}

function expandKey(key: Uint8Array): Uint8Array[] {
  if (![16, 24, 32].includes(key.byteLength)) throw new RangeError(`AES key must be 16, 24 or 32 bytes, got ${key.byteLength}`);
  const nk = key.byteLength / 4;
  const rounds = nk + 6;
  const words: Uint8Array[] = [];
  for (let i = 0; i < nk; i++) words.push(key.slice(i * 4, i * 4 + 4));
  let rcon = 1;
  for (let i = nk; i < 4 * (rounds + 1); i++) {
    let t = words[i - 1]!.slice();
    if (i % nk === 0) {
      t = new Uint8Array([SBOX[t[1]!]! ^ rcon, SBOX[t[2]!]!, SBOX[t[3]!]!, SBOX[t[0]!]!]);
      rcon = xtime(rcon);
    } else if (nk > 6 && i % nk === 4) {
      t = t.map((b) => SBOX[b]!);
    }
    const prev = words[i - nk]!;
    words.push(t.map((b, j) => b ^ prev[j]!));
  }
  const roundKeys: Uint8Array[] = [];
  for (let r = 0; r <= rounds; r++) {
    const rk = new Uint8Array(16);
    for (let c = 0; c < 4; c++) rk.set(words[r * 4 + c]!, c * 4);
    roundKeys.push(rk);
  }
  return roundKeys;
}

function addRoundKey(s: Uint8Array, k: Uint8Array): void {
  for (let i = 0; i < 16; i++) s[i]! ^= k[i]!;
}

function shiftRows(s: Uint8Array, inverse: boolean): void {
  const t = s.slice();
  for (let r = 1; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const from = inverse ? (c - r + 4) % 4 : (c + r) % 4;
      s[c * 4 + r] = t[from * 4 + r]!;
    }
  }
}

function mixColumns(s: Uint8Array, inverse: boolean): void {
  const [a, b, c, d] = inverse ? [14, 11, 13, 9] : [2, 3, 1, 1];
  for (let col = 0; col < 4; col++) {
    const i = col * 4;
    const [s0, s1, s2, s3] = [s[i]!, s[i + 1]!, s[i + 2]!, s[i + 3]!];
    s[i] = mul(s0, a) ^ mul(s1, b) ^ mul(s2, c) ^ mul(s3, d);
    s[i + 1] = mul(s0, d) ^ mul(s1, a) ^ mul(s2, b) ^ mul(s3, c);
    s[i + 2] = mul(s0, c) ^ mul(s1, d) ^ mul(s2, a) ^ mul(s3, b);
    s[i + 3] = mul(s0, b) ^ mul(s1, c) ^ mul(s2, d) ^ mul(s3, a);
  }
}

function encryptBlock(block: Uint8Array, keys: Uint8Array[]): Uint8Array {
  const s = block.slice();
  const rounds = keys.length - 1;
  addRoundKey(s, keys[0]!);
  for (let r = 1; r <= rounds; r++) {
    for (let i = 0; i < 16; i++) s[i] = SBOX[s[i]!]!;
    shiftRows(s, false);
    if (r !== rounds) mixColumns(s, false);
    addRoundKey(s, keys[r]!);
  }
  return s;
}

function decryptBlock(block: Uint8Array, keys: Uint8Array[]): Uint8Array {
  const s = block.slice();
  const rounds = keys.length - 1;
  addRoundKey(s, keys[rounds]!);
  for (let r = rounds - 1; r >= 0; r--) {
    shiftRows(s, true);
    for (let i = 0; i < 16; i++) s[i] = INV_SBOX[s[i]!]!;
    addRoundKey(s, keys[r]!);
    if (r !== 0) mixColumns(s, true);
  }
  return s;
}

export function pkcs7Pad(data: Uint8Array): Uint8Array {
  const pad = 16 - (data.byteLength % 16);
  const out = new Uint8Array(data.byteLength + pad);
  out.set(data);
  out.fill(pad, data.byteLength);
  return out;
}

export function pkcs7Unpad(data: Uint8Array): Uint8Array {
  const pad = data[data.byteLength - 1] ?? 0;
  if (pad < 1 || pad > 16 || pad > data.byteLength) throw new RangeError('bad PKCS#7 padding');
  for (let i = data.byteLength - pad; i < data.byteLength; i++) if (data[i] !== pad) throw new RangeError('bad PKCS#7 padding');
  return data.slice(0, data.byteLength - pad);
}

function checkBlocks(data: Uint8Array): void {
  if (data.byteLength % 16 !== 0) throw new RangeError('AES data length must be a multiple of 16');
}

/** AES-ECB без паддинга (паддинг — pkcs7Pad/pkcs7Unpad) */
export function aesEcbEncrypt(key: Uint8Array, data: Uint8Array): Uint8Array {
  checkBlocks(data);
  const keys = expandKey(key);
  const out = new Uint8Array(data.byteLength);
  for (let i = 0; i < data.byteLength; i += 16) out.set(encryptBlock(data.subarray(i, i + 16), keys), i);
  return out;
}

export function aesEcbDecrypt(key: Uint8Array, data: Uint8Array): Uint8Array {
  checkBlocks(data);
  const keys = expandKey(key);
  const out = new Uint8Array(data.byteLength);
  for (let i = 0; i < data.byteLength; i += 16) out.set(decryptBlock(data.subarray(i, i + 16), keys), i);
  return out;
}

export function aesCbcEncrypt(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Uint8Array {
  checkBlocks(data);
  const keys = expandKey(key);
  const out = new Uint8Array(data.byteLength);
  let prev: Uint8Array = iv.slice(0, 16);
  for (let i = 0; i < data.byteLength; i += 16) {
    const block = data.slice(i, i + 16).map((b, j) => b ^ prev[j]!);
    prev = encryptBlock(block, keys);
    out.set(prev, i);
  }
  return out;
}

export function aesCbcDecrypt(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Uint8Array {
  checkBlocks(data);
  const keys = expandKey(key);
  const out = new Uint8Array(data.byteLength);
  let prev: Uint8Array = iv.slice(0, 16);
  for (let i = 0; i < data.byteLength; i += 16) {
    const block = data.slice(i, i + 16);
    out.set(decryptBlock(block, keys).map((b, j) => b ^ prev[j]!), i);
    prev = block;
  }
  return out;
}
