import { CAREER_KEY, isCareerState, replaces, sanitize, type Stamped } from '../src/account/protocol';
import { applyUpgrades, buyCar, buyUpgrade, claimDailyBonus, DAILY_BONUS, FINISH_PRIZE, newCareer, prizeFor, START_MONEY, STARTER_CAR } from '../src/career/career';
import { afterLeg, CHAMPIONSHIPS, championshipPrize, championshipTargets, isProgress, repairCost, type CarDamage } from '../src/career/championship';
import { kvarn240 } from '../src/physics/params';
import { STAGES } from '../src/physics/stage';
import { carSpecs } from '../src/physics/specs';

let failures = 0;
function check(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}: ${detail}`);
  if (!ok) failures++;
}

// 1. Ny karriär, köp och dagsbonus.
{
  let c = newCareer();
  check('ny karriär', c.money === START_MONEY && !!c.garage[STARTER_CAR] && isCareerState(c), `${c.money} kr, ${Object.keys(c.garage).join()}`);
  const engine = buyUpgrade(c, STARTER_CAR, 'engine');
  check('köpa uppgradering', typeof engine === 'object' && engine.money === START_MONEY - 2000 && engine.garage[STARTER_CAR]!.upgrades.engine === 1 && c.money === START_MONEY, typeof engine === 'object' ? `${engine.money} kr kvar` : engine);
  check('för lite pengar', buyUpgrade(engine as typeof c, STARTER_CAR, 'engine') === 'poor' && buyCar(c, 'Kvarn 240 Turbo') === 'poor', 'nekas');
  check('okänt', buyUpgrade(c, 'Ingen bil', 'engine') === 'unknown' && buyCar(c, STARTER_CAR) === 'unknown', 'nekas');
  c = { ...c, money: 100_000 };
  for (let i = 0; i < 3; i++) c = buyUpgrade(c, STARTER_CAR, 'tyres') as typeof c;
  check('max nivå', buyUpgrade(c, STARTER_CAR, 'tyres') === 'maxed', `däck nivå ${c.garage[STARTER_CAR]!.upgrades.tyres}`);
  const turbo = buyCar(c, 'Kvarn 240 Turbo');
  check('köpa bil', typeof turbo === 'object' && !!turbo.garage['Kvarn 240 Turbo'] && turbo.money === c.money - 15000, typeof turbo === 'object' ? Object.keys(turbo.garage).join(', ') : turbo);
  const a = claimDailyBonus(c, '2026-11-26');
  const b = claimDailyBonus(a.career, '2026-11-26');
  const d = claimDailyBonus(b.career, '2026-11-27');
  check('dagsbonus en gång per dag', a.bonus === DAILY_BONUS && b.bonus === 0 && d.bonus === DAILY_BONUS && d.career.money === c.money + 2 * DAILY_BONUS, `${a.bonus}, ${b.bonus}, ${d.bonus}`);
}

// 2. Prispengar.
{
  const p = [85, 95, 110, 130].map((t) => prizeFor('Skogsberg', t));
  check('prispengar efter tid', p.map((x) => x.medal).join() === 'guld,silver,brons,' && p[3]!.prize === FINISH_PRIZE && p[0]!.prize > p[1]!.prize, p.map((x) => `${x.medal ?? 'mål'} ${x.prize}`).join(', '));
  check('okänd etapp', prizeFor('Ingenstans', 50).prize === FINISH_PRIZE, 'målpeng');
}

// 3. Uppgraderingar ändrar bilen, men inte grundbilen.
{
  const base = kvarn240();
  const tuned = applyUpgrades(base, { engine: 3, brakes: 2, tyres: 1 });
  check('uppgraderingar', tuned.engine.curveNm[3]! > base.engine.curveNm[3]! * 1.17 && tuned.brake.total > base.brake.total && tuned.gripScale > base.gripScale && kvarn240().engine.curveNm[3] === base.engine.curveNm[3], `${base.engine.curveNm[3]} → ${tuned.engine.curveNm[3]!.toFixed(0)} Nm`);
  const s0 = carSpecs(base);
  const s3 = carSpecs(applyUpgrades(base, { engine: 3 }));
  check('motorn gör bilen snabbare', s3.zeroTo100 < s0.zeroTo100 - 0.3, `0–100 ${s0.zeroTo100.toFixed(1)} → ${s3.zeroTo100.toFixed(1)} s`);
}

// 4. Synk: karriären valideras och senaste ändringen vinner.
{
  const old: Stamped = [JSON.stringify(newCareer()), 100];
  const fresh: Stamped = [JSON.stringify({ ...newCareer(), money: 9000 }), 200];
  check('senaste karriären vinner', replaces(CAREER_KEY, fresh, old) && !replaces(CAREER_KEY, old, fresh), 'ok');
  const clean = sanitize({ [CAREER_KEY]: old, careerx: old });
  const bad = sanitize({ [CAREER_KEY]: [JSON.stringify({ money: -5, garage: {} }), 1] });
  check('karriär saneras', Object.keys(clean).join() === CAREER_KEY && Object.keys(bad).length === 0 && !isCareerState({ money: 1.5, garage: {} }), Object.keys(clean).join());
}

// 5. Mästerskap: gränser, priser, reparation och framsteg.
{
  const def = CHAMPIONSHIPS[0]!;
  const legsExist = CHAMPIONSHIPS.every((c) => c.legs.every((name) => STAGES.some((s) => s.name === name)) && !!championshipTargets(c));
  const targets = championshipTargets(def);
  check('mästerskap: etapper och gränser', legsExist && !!targets && targets[0] === 183, `${CHAMPIONSHIPS.length} mästerskap, ${def.legs.join(' + ')}: guld under ${targets?.[0]} s`);
  const prizes = [180, 200, 230, 300].map((t) => championshipPrize(def, t));
  check('mästerskap: prispengar', prizes.map((p) => p.medal).join() === 'guld,silver,brons,' && prizes[0]!.prize > 1200 * 2, prizes.map((p) => `${p.medal ?? 'mål'} ${p.prize}`).join(', '));
  const none: CarDamage = { body: { front: 0, rear: 0, left: 0, right: 0, roof: 0 }, wheels: [0, 0, 0, 0], powerFactor: 1 };
  const crashed: CarDamage = { body: { front: 0.6, rear: 0, left: 0.2, right: 0, roof: 0 }, wheels: [0.3, 0, 0, 0], powerFactor: 0.76 };
  check('mästerskap: reparationskostnad', repairCost(none) === 0 && repairCost(crashed) === 2400, `${repairCost(crashed)} kr`);
  const start = { id: def.id, car: 'Kvarn 240 GL', leg: 0, times: [], damage: null };
  const next = afterLeg(start, 91.2, crashed, false);
  const fixed = afterLeg(start, 91.2, crashed, true);
  check('mästerskap: framsteg', isProgress(start) && isProgress(next) && next.leg === 1 && next.damage === crashed && fixed.damage === null && !isProgress({ ...next, leg: 2, times: [1, 2] }) && !isProgress({ ...start, id: 'okänt' }), `etapp ${next.leg + 1}, tider ${next.times.join()}`);
}

if (failures) {
  console.log(`\n${failures} test(er) misslyckades`);
  process.exit(1);
}
console.log('\nAlla karriärtester gick bra');
