/**
 * En återställningsnyckel är kontots hemlighet skriven så att den kan skrivas av för hand,
 * som 7KQM-3XF2-…: 28 tecken Crockford base32 i grupper om fyra. Den rymmer hemlighetens
 * 128 bitar och 10 kontrollbitar, så en felskriven nyckel avvisas i stället för att leda till
 * ett nytt, tomt konto. Alfabetet saknar I, L, O och U; I och L läses som 1 och O som 0.
 * Samma format som i season-o-meter.
 */

import { fromBase64Url, isSecret, toBase64Url } from './protocol';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const SECRET_BYTES = 16;
const CHECK_BITS = 10;
/** 128 + 10 bitar, och 2 nollbitar som fyller sista tecknet. */
const LENGTH = 28;
const GROUP = 4;

/** Bitar från FNV-1a över hemlighetens byte. */
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

/** Hemligheten i en återställningsnyckel, eller null om det inte är en giltig nyckel. */
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
