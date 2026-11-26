import { CAREER_KEY, isCareerState, MAX_HISTORY, replaces, sanitize, type Stamped } from '../src/account/protocol';
import { applyUpgrades, buyCar, logged, migrateCareer, buyUpgrade, claimDailyBonus, DAILY_BONUS, FINISH_PRIZE, newCareer, prizeFor, START_MONEY } from '../src/career/career';
import { afterLeg, CHAMPIONSHIPS, championshipPrize, championshipUnlocked, withWin, championshipTargets, isProgress, legWeather, newProgress, raceRivals, repairCost, repairPart, type CarDamage } from '../src/career/championship';
import { raceLeg, RIVAL_COUNT, standings } from '../src/career/rivals';
import { STAGE_TARGETS } from '../src/career/career';
import { kvarn240 } from '../src/physics/params';
import { STAGES } from '../src/physics/stage';
import { carSpecs } from '../src/physics/specs';

let failures = 0;
function check(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}: ${detail}`);
  if (!ok) failures++;
}

const CAR = 'Kvarn 240 GL';

// 1. Ny karriär utan bil, första bilen, köp och dagsbonus.
{
  const fresh = newCareer();
  check('ny karriär utan bil', fresh.money === START_MONEY && Object.keys(fresh.garage).length === 0 && isCareerState(fresh), `${fresh.money} kr`);
  const affordable = ['Kvarn 240 GL', 'Ljung 1600 S'].every((car) => typeof buyCar(fresh, car) === 'object') && buyCar(fresh, 'Kvarn 240 Turbo') === 'poor';
  check('startpengarna räcker till en billig bil', affordable, 'GL och Ljung går, Turbo nekas');
  let c = buyCar(fresh, CAR) as typeof fresh;
  const START = c.money;
  check('första bilen', !!c.garage[CAR] && START === START_MONEY - 6000, `${START} kr kvar`);
  const exhaust = buyUpgrade(c, CAR, 'exhaust');
  check('köpa uppgradering', typeof exhaust === 'object' && exhaust.money === START - 2000 && exhaust.garage[CAR]!.upgrades.exhaust === 1 && c.money === START, typeof exhaust === 'object' ? `${exhaust.money} kr kvar` : exhaust);
  check('för lite pengar', buyUpgrade({ ...c, money: 1000 }, CAR, 'gearbox') === 'poor' && buyCar(c, 'Kvarn 240 Turbo') === 'poor', 'nekas');
  check('okänt', buyUpgrade(c, 'Ingen bil', 'exhaust') === 'unknown' && buyUpgrade(c, CAR, 'engine') === 'unknown' && buyCar(c, CAR) === 'unknown', 'nekas');
  c = { ...c, money: 100_000 };
  c = buyUpgrade(c, CAR, 'rallytyres') as typeof c;
  check('redan monterad', buyUpgrade(c, CAR, 'rallytyres') === 'maxed', 'nekas');
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
  const engine = { airfilter: 1, exhaust: 1, racecat: 1, cams: 1, pistons: 1 };
  const tuned = applyUpgrades(base, { ...engine, pads: 1, rallytyres: 1 });
  check('uppgraderingar', tuned.engine.curveNm[3]! > base.engine.curveNm[3]! * 1.1 && tuned.engine.limiterRpm > base.engine.limiterRpm && tuned.brake.total > base.brake.total && tuned.gripScale > base.gripScale && kvarn240().engine.curveNm[3] === base.engine.curveNm[3], `${base.engine.curveNm[3]} → ${tuned.engine.curveNm[3]!.toFixed(0)} Nm`);
  const s0 = carSpecs(base);
  const s3 = carSpecs(applyUpgrades(base, engine));
  check('motorn gör bilen snabbare', s3.zeroTo100 < s0.zeroTo100 - 0.3, `0–100 ${s0.zeroTo100.toFixed(1)} → ${s3.zeroTo100.toFixed(1)} s`);
}

// 3b. Gamla nivåuppgraderingar återbetalas.
{
  const old = { ...newCareer(), garage: { [CAR]: { upgrades: { engine: 2, tyres: 1, pads: 1 } } } };
  const m = migrateCareer(old);
  check('gamla uppgraderingar återbetalas', m.money === START_MONEY + 2000 + 4500 + 1500 && JSON.stringify(m.garage[CAR]!.upgrades) === '{"pads":1}' && migrateCareer(m) === m, `${m.money} kr`);
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
  check('mästerskap: etapper och gränser', legsExist && !!targets && targets[0] === 279 && def.legs.length === 3 && STAGES.every((s) => CHAMPIONSHIPS.some((c) => c.legs.includes(s.name))), `${CHAMPIONSHIPS.length} mästerskap, ${def.legs.join(' + ')}: guld under ${targets?.[0]} s`);
  const prizes = [1, 2, 3, 4].map((place) => championshipPrize(def, place));
  check('mästerskap: prispengar', prizes.map((p) => p.medal).join() === 'guld,silver,brons,' && prizes[0]!.prize === 9000, prizes.map((p) => `${p.medal ?? 'mål'} ${p.prize}`).join(', '));
  const none: CarDamage = { body: { front: 0, rear: 0, left: 0, right: 0, roof: 0 }, wheels: [0, 0, 0, 0], powerFactor: 1 };
  const crashed: CarDamage = { body: { front: 0.6, rear: 0, left: 0.2, right: 0, roof: 0 }, wheels: [0.3, 0, 0, 0], powerFactor: 0.76 };
  const noLamp: CarDamage = { ...crashed, lamps: [0.6, 0] };
  check('mästerskap: reparationskostnad', repairCost(none) === 0 && repairCost(crashed) === 2400 && repairCost(noLamp) === 2750, `${repairCost(crashed)} kr, med trasig lykta ${repairCost(noLamp)} kr`);
  const lampsFixed = repairPart(noLamp, 'lamps');
  check('mästerskap: laga en del', repairCost(lampsFixed) === 2400 && lampsFixed.powerFactor === 0.76 && repairCost(repairPart(repairPart(repairPart(lampsFixed, 'body'), 'wheels'), 'engine')) === 0, `lyktorna för ${repairCost(noLamp) - repairCost(lampsFixed)} kr`);
  const start = { id: def.id, car: 'Kvarn 240 GL', leg: 0, times: [], damage: null };
  const next = afterLeg(start, 91.2, crashed, false);
  const fixed = afterLeg(start, 91.2, crashed, true);
  check('mästerskap: framsteg', isProgress(start) && isProgress(next) && next.leg === 1 && next.damage === crashed && fixed.damage === null && !isProgress({ ...next, leg: 3, times: [1, 2, 3] }) && isProgress(afterLeg(start, 91.2, noLamp, false)) && !isProgress(afterLeg(start, 91.2, { ...noLamp, lamps: [2, 0] }, false)) && !isProgress({ ...start, id: 'okänt' }), `etapp ${next.leg + 1}, tider ${next.times.join()}`);
}

// 6. Motståndarna: den som kör i guldfart slåss om pallen, den som kör mycket fortare än guld
// vinner oftast men inte alltid, och den som kör i bronsfart vinner nästan aldrig.
{
  const def = CHAMPIONSHIPS[0]!;
  const fresh = newProgress(def, 'Kvarn 240 GL', 42);
  const names = new Set(fresh.rivals!.map((v) => v.name));
  check('motståndare: ett fält', fresh.rivals!.length === RIVAL_COUNT && names.size === RIVAL_COUNT && Math.min(...fresh.rivals!.map((v) => v.pace)) <= 1 && isProgress(fresh), [...names].slice(0, 3).join(', ') + ' …');
  const run = (pace: number, seed: number, known?: number) => {
    let p = newProgress(def, 'Kvarn 240 GL', seed, known);
    for (const leg of def.legs) {
      const time = STAGE_TARGETS[leg]![0] * pace;
      p = afterLeg(raceRivals(p, time), time, { body: { front: 0, rear: 0, left: 0, right: 0, roof: 0 }, wheels: [0, 0, 0, 0], powerFactor: 1 }, true);
    }
    return { place: standings(p.rivals!, p.times).findIndex((s) => s.player) + 1, valid: isProgress({ ...p, leg: p.leg - 1, times: p.times.slice(0, -1), rivals: p.rivals!.map((v) => ({ ...v, times: v.times.slice(0, -1) })) }) };
  };
  const winRate = (pace: number, known?: number) => {
    const results = Array.from({ length: 300 }, (_, seed) => run(pace, seed, known));
    return { wins: results.filter((r) => r.place === 1).length / results.length, podium: results.filter((r) => r.place <= 3).length / results.length, valid: results.every((r) => r.valid) };
  };
  const gold = winRate(1);
  // 20 % snabbare än guld: utan rekord hinner fältet inte ikapp efter första etappen; med
  // rekord i samma fart möts spelaren av motstånd från start.
  const fast = winRate(0.8);
  const known = winRate(0.8, 0.8);
  const slow = winRate(1.25);
  const ok = gold.valid && gold.wins > 0.05 && gold.wins < 0.5 && gold.podium > 0.4 && fast.wins > 0.5 && known.wins > 0.2 && known.wins < 0.85 && slow.wins < 0.02;
  check('motståndare: utmaning men går att vinna', ok, `vinst i guldfart ${(gold.wins * 100).toFixed(0)} % (pall ${(gold.podium * 100).toFixed(0)} %), 20 % snabbare ${(fast.wins * 100).toFixed(0)} %, dito med rekord ${(known.wins * 100).toFixed(0)} %, bronsfart ${(slow.wins * 100).toFixed(0)} %`);
  // Väder: samma frö ger samma väder, och motståndarna kör långsammare i regn.
  const same = def.legs.every((_, i) => legWeather(fresh, i) === legWeather({ ...fresh }, i));
  const dryLeg = raceLeg(fresh.rivals!, def.legs, 0, [90], 7)[0]!.times[0]!;
  const wetLeg = raceLeg(fresh.rivals!, def.legs, 0, [90], 7, [1.05])[0]!.times[0]!;
  check('motståndare: väder', same && wetLeg > dryLeg * 1.03, `torrt ${dryLeg.toFixed(1)} s, regn ${wetLeg.toFixed(1)} s`);
  // Gammalt framsteg utan motståndare får ett fält i efterhand.
  const old = { id: def.id, car: 'Kvarn 240 GL', leg: 1, times: [91], damage: null };
  const caught = raceRivals(old, 94);
  check('motståndare: gammalt framsteg', caught.rivals!.length === RIVAL_COUNT && caught.rivals!.every((v) => v.times.length === 2), `${caught.rivals![0]!.times.join(', ')}`);
}

// Historik: köp loggas, listan kapas och trasiga rader underkänns.
{
  const c = buyUpgrade(buyCar(newCareer(), CAR) as ReturnType<typeof newCareer>, CAR, 'pads') as ReturnType<typeof newCareer>;
  const kinds = c.history!.map((e) => `${e.kind}:${e.amount}`).join(', ');
  check('historik: köp loggas', kinds === 'car:-6000, upgrade:-1000' && isCareerState(c), kinds);
  let full = c;
  for (let i = 0; i < MAX_HISTORY + 5; i++) full = logged(full, { kind: 'stage', name: 'Skogsberg', car: CAR, time: 90 + i, medal: null, amount: 250 });
  check('historik: kapas', full.history!.length === MAX_HISTORY && full.history!.at(-1)!.time === 90 + MAX_HISTORY + 4 && isCareerState(full), `${full.history!.length} rader`);
  const bad = { ...c, history: [{ kind: 'stage', at: 1, name: '', amount: 0 }] };
  check('historik: saneras', !isCareerState(bad) && !isCareerState({ ...c, history: [{ ...c.history![0]!, amount: 1.5 }] }), 'nekas');
}

// Mästerskapen låses upp i ordning; gamla vinster i historiken räknas.
{
  const skog = CHAMPIONSHIPS[0]!;
  const myr = CHAMPIONSHIPS[1]!;
  const open = (c: ReturnType<typeof newCareer>) => CHAMPIONSHIPS.map((ch) => (championshipUnlocked(c, ch) ? 1 : 0)).join('');
  const fresh = newCareer();
  const one = withWin(fresh, skog);
  const myrOnly = withWin(fresh, myr);
  const both = withWin(one, myr);
  const old = logged(fresh, { kind: 'championship', name: skog.name, car: CAR, place: 1, of: 8, time: 300, amount: 9000 });
  const second = logged(fresh, { kind: 'championship', name: skog.name, car: CAR, place: 2, of: 8, time: 300, amount: 6000 });
  const ok = open(fresh) === '100' && open(one) === '110' && open(myrOnly) === '100' && open(both) === '111' && open(old) === '110' && open(second) === '100';
  check('mästerskap: upplåsning', ok && withWin(one, skog) === one && isCareerState(both) && !isCareerState({ ...fresh, won: [''] }), `${open(fresh)} ${open(one)} ${open(both)}`);
}

if (failures) {
  console.log(`\n${failures} test(er) misslyckades`);
  process.exit(1);
}
console.log('\nAlla karriärtester gick bra');
