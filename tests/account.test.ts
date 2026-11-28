import { accountIdFor, isSecret, newSecret, recordKey, replaces, sanitize, type Stamped } from '../src/account/protocol';
import { recoveryKey, secretFromKey } from '../src/account/recoveryKey';

let failures = 0;
function check(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}: ${detail}`);
  if (!ok) failures++;
}

// 1. Secret, account id and recovery key.
{
  const secret = newSecret();
  const id = await accountIdFor(secret);
  check('secret and id', isSecret(secret) && isSecret(id) && id !== secret && id === (await accountIdFor(secret)), `${secret} → ${id}`);
  const key = recoveryKey(secret);
  const back = secretFromKey(key.toLowerCase().replace(/1/g, 'l').replace(/0/g, 'o'));
  check('recovery key round trip', /^([0-9A-Z]{4}-){6}[0-9A-Z]{4}$/.test(key) && back === secret, key);
  // Change one character: the check bits should reject almost all typos.
  let accepted = 0;
  for (let i = 0; i < key.length; i++) {
    if (key[i] === '-') continue;
    for (const c of '0123456789ABCDEFGHJKMNPQRSTVWXYZ') {
      if (c !== key[i] && secretFromKey(key.slice(0, i) + c + key.slice(i + 1))) accepted++;
    }
  }
  check('mistyped key rejected', accepted < 5, `${accepted} of ${28 * 31} single-character errors accepted`);
  check('garbage rejected', secretFromKey('hej') === null && secretFromKey('') === null, 'ok');
}

// 2. Merging: lowest time wins, regardless of order.
{
  const rec = (time: number, at: number): Stamped => [JSON.stringify({ time, splits: [time / 3, (2 * time) / 3] }), at];
  const fast = rec(88.5, 1);
  const slow = rec(91.2, 2);
  const k = recordKey({ name: 'Skogsberg', version: '1.0.0', recordsSince: '1.0.0' });
  check('lowest time wins', replaces(k, fast, slow) && !replaces(k, slow, fast) && replaces(k, slow, undefined) && !replaces(k, fast, fast), 'faster replaces slower, not the other way round');
  const key = recordKey({ name: 'Skogsberg', version: '1.2.3', recordsSince: '1.2.0' });
  const clean = sanitize({
    [key]: fast,
    'best:Skogsberg': fast, // without version epoch
    [`${key}x`]: fast,
    [recordKey({ name: 'Skogsberg', version: '2.0.0', recordsSince: '2.0.0' })]: [JSON.stringify({ time: -1, splits: [] }), 1],
    other: ['x', 1],
  });
  check('sanitizing', Object.keys(clean).join() === key && key === 'best:Skogsberg:1:1.2.0', Object.keys(clean).join() || 'empty');
  check('broken data', Object.keys(sanitize(null)).length === 0 && Object.keys(sanitize([1, 2])).length === 0 && Object.keys(sanitize({ [key]: ['{', 1] })).length === 0, 'ok');
}

if (failures) {
  console.log(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log('\nAll account tests passed');
