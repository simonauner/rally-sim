/**
 * A recovery key is the account's secret written so it can be copied by hand,
 * like 7KQM-3XF2-…: 28 characters of Crockford base32 in groups of four. It holds the secret's
 * 128 bits and 10 check bits, so a mistyped key is rejected instead of leading to
 * a new, empty account. The alphabet lacks I, L, O and U; I and L are read as 1 and O as 0.
 * Same format as in season-o-meter.
 */

import { fromBase64Url, isSecret, toBase64Url } from './protocol';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const SECRET_BYTES = 16;
const CHECK_BITS = 10;
/** 128 + 10 bits, plus 2 zero bits that fill the last character. */
const LENGTH = 28;
const GROUP = 4;

/** Bits from FNV-1a over the secret's bytes. */
function check(bytes: Uint8Array) {
  let hash = 0x811c9dc5;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 0x01000193);
  return (hash >>> 0) % 2 ** CHECK_BITS;
}

const bitsOf = (value: number, width: number) => value.toString(2).padStart(width, '0');

export function recoveryKey(secret: string) {
  const bytes = fromBase64Url(secret);
  const bits = [...bytes, check(bytes)]
    .map((value, i) => bitsOf(value, i < bytes.length ? 8 : CHECK_BITS))
    .join('')
    .padEnd(LENGTH * 5, '0');
  let key = '';
  for (let i = 0; i < LENGTH; i++) {
    if (i > 0 && i % GROUP === 0) key += '-';
    key += ALPHABET[parseInt(bits.slice(i * 5, i * 5 + 5), 2)];
  }
  return key;
}

/** The secret in a recovery key, or null if it is not a valid key. */
export function secretFromKey(input: string): string | null {
  const text = input.toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
  if (text.length !== LENGTH) return null;
  let bits = '';
  for (const char of text) {
    const value = ALPHABET.indexOf(char);
    if (value < 0) return null;
    bits += bitsOf(value, 5);
  }
  const bytes = Uint8Array.from({ length: SECRET_BYTES }, (_, i) => parseInt(bits.slice(i * 8, i * 8 + 8), 2));
  const end = SECRET_BYTES * 8;
  const checked = parseInt(bits.slice(end, end + CHECK_BITS), 2);
  if (check(bytes) !== checked || /1/.test(bits.slice(end + CHECK_BITS))) return null;
  const secret = toBase64Url(bytes);
  return isSecret(secret) ? secret : null;
}
