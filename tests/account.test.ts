import { accountIdFor, isSecret, newSecret, recordKey, replaces, sanitize, type Stamped } from '../src/account/protocol';
import { recoveryKey, secretFromKey } from '../src/account/recoveryKey';

let failures = 0;
function check(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}: ${detail}`);
  if (!ok) failures++;
}

// 1. Hemlighet, konto-id och återställningsnyckel.
{
  const secret = newSecret();
  const id = await accountIdFor(secret);
  check('hemlighet och id', isSecret(secret) && isSecret(id) && id !== secret && id === (await accountIdFor(secret)), `${secret} → ${id}`);
  const key = recoveryKey(secret);
  const back = secretFromKey(key.toLowerCase().replace(/1/g, 'l').replace(/0/g, 'o'));
  check('återställningsnyckel tur och retur', /^([0-9A-Z]{4}-){6}[0-9A-Z]{4}$/.test(key) && back === secret, key);
  // Ändra ett tecken: kontrollbitarna ska avvisa nästan alla felskrivningar.
  let accepted = 0;
  for (let i = 0; i < key.length; i++) {
    if (key[i] === '-') continue;
    for (const c of '0123456789ABCDEFGHJKMNPQRSTVWXYZ') {
      if (c !== key[i] && secretFromKey(key.slice(0, i) + c + key.slice(i + 1))) accepted++;
    }
  }
  check('felskriven nyckel avvisas', accepted < 5, `${accepted} av ${28 * 31} enteckensfel godtogs`);
  check('skräp avvisas', secretFromKey('hej') === null && secretFromKey('') === null, 'ok');
}

// 2. Sammanslagning: lägsta tid vinner, oavsett ordning.
{
  const rec = (time: number, at: number): Stamped => [JSON.stringify({ time, splits: [time / 3, (2 * time) / 3] }), at];
  const fast = rec(88.5, 1);
  const slow = rec(91.2, 2);
  const k = recordKey({ name: 'Skogsberg', version: '1.0.0', recordsSince: '1.0.0' });
  check('lägsta tid vinner', replaces(k, fast, slow) && !replaces(k, slow, fast) && replaces(k, slow, undefined) && !replaces(k, fast, fast), 'snabbare ersätter långsammare, inte tvärtom');
  const key = recordKey({ name: 'Skogsberg', version: '1.2.3', recordsSince: '1.2.0' });
  const clean = sanitize({
    [key]: fast,
    'best:Skogsberg': fast, // utan versionsepok
    [`${key}x`]: fast,
    [recordKey({ name: 'Skogsberg', version: '2.0.0', recordsSince: '2.0.0' })]: [JSON.stringify({ time: -1, splits: [] }), 1],
    other: ['x', 1],
  });
  check('sanering', Object.keys(clean).join() === key && key === 'best:Skogsberg:1:1.2.0', Object.keys(clean).join() || 'tomt');
  check('trasig data', Object.keys(sanitize(null)).length === 0 && Object.keys(sanitize([1, 2])).length === 0 && Object.keys(sanitize({ [key]: ['{', 1] })).length === 0, 'ok');
}

if (failures) {
  console.log(`\n${failures} test(er) misslyckades`);
  process.exit(1);
}
console.log('\nAlla kontotester gick bra');
