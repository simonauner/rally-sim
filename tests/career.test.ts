import { CAREER_KEY, isCareerState, MAX_HISTORY, replaces, sanitize, type Stamped } from '../src/account/protocol';
import { applyUpgrades, buyCar, logged, migrateCareer, buyUpgrade, claimDailyBonus, DAILY_BONUS, FINISH_PRIZE, MEDALS, newCareer, prizeFor, START_MONEY, tierOf, upgradesFor } from '../src/career/career';
import { afterLeg, bestPlace, carUnlocked, CHAMPIONSHIPS, championshipPrize, championshipUnlocked, difficultyOf, tierUnlocked, unlockHint, withWin, championshipTargets, isProgress, startOrder, aheadOnRoad, legWeather, newProgress, raceRivals, repairCost, repairPart, type CarDamage } from '../src/career/championship';
import { raceLeg, RIVAL_COUNT, standings } from '../src/career/rivals';
import { STAGE_TARGETS } from '../src/career/career';
import { CARS, kvarn240, strandTurbo4x4 } from '../src/physics/params';
import { STAGES } from '../src/physics/stage';
import { carSpecs } from '../src/physics/specs';
import { checkRun, settleWeek, traceOf, TRACE_HZ, weeklyChallenge, weeklyPrize } from '../src/career/weekly';
import { Stage, START_S } from '../src/physics/stage';
import { stageTargets } from '../src/career/career';
import { isDriverName, weekEnd, weekOf } from '../src/account/protocol';

let failures = 0;
function check(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}: ${detail}`);
  if (!ok) failures++;
}

const CAR = 'Kvarn 240 GL';

// 1. New career without a car, first car, purchases and daily bonus.
{
  const fresh = newCareer();
  check('new career without a car', fresh.money === START_MONEY && Object.keys(fresh.garage).length === 0 && isCareerState(fresh), `${fresh.money} kr`);
  const affordable = ['Kvarn 240 GL', 'Ljung 1600 S'].every((car) => typeof buyCar(fresh, car) === 'object') && buyCar(fresh, 'Kvarn 240 Turbo') === 'poor';
  check('starting money buys a cheap car', affordable, 'GL and Ljung allowed, Turbo rejected');
  let c = buyCar(fresh, CAR) as typeof fresh;
  const START = c.money;
  check('first car', !!c.garage[CAR] && START === START_MONEY - 6000, `${START} kr left`);
  const exhaust = buyUpgrade(c, CAR, 'exhaust');
  check('buy upgrade', typeof exhaust === 'object' && exhaust.money === START - 2000 && exhaust.garage[CAR]!.upgrades.exhaust === 1 && c.money === START, typeof exhaust === 'object' ? `${exhaust.money} kr left` : exhaust);
  check('too little money', buyUpgrade({ ...c, money: 1000 }, CAR, 'gearbox') === 'poor' && buyCar(c, 'Kvarn 240 Turbo') === 'poor', 'rejected');
  check('unknown', buyUpgrade(c, 'Ingen bil', 'exhaust') === 'unknown' && buyUpgrade(c, CAR, 'engine') === 'unknown' && buyCar(c, CAR) === 'unknown', 'rejected');
  c = { ...c, money: 100_000 };
  c = buyUpgrade(c, CAR, 'rallytyres') as typeof c;
  check('already fitted', buyUpgrade(c, CAR, 'rallytyres') === 'maxed', 'rejected');
  const turbo = buyCar(c, 'Kvarn 240 Turbo');
  check('buy car', typeof turbo === 'object' && !!turbo.garage['Kvarn 240 Turbo'] && turbo.money === c.money - 15000, typeof turbo === 'object' ? Object.keys(turbo.garage).join(', ') : turbo);
  const a = claimDailyBonus(c, '2026-11-26');
  const b = claimDailyBonus(a.career, '2026-11-26');
  const d = claimDailyBonus(b.career, '2026-11-27');
  check('daily bonus once per day', a.bonus === DAILY_BONUS && b.bonus === 0 && d.bonus === DAILY_BONUS && d.career.money === c.money + 2 * DAILY_BONUS, `${a.bonus}, ${b.bonus}, ${d.bonus}`);
}

// 2. Prize money.
{
  const [g, sv, b] = STAGE_TARGETS.Grinsbol!;
  const p = [g - 1, sv - 1, b - 1, b + 10].map((t) => prizeFor('Grinsbol', t));
  check('prize money by time', p.map((x) => x.medal).join() === 'guld,silver,brons,' && p[3]!.prize === FINISH_PRIZE && p[0]!.prize > p[1]!.prize, p.map((x) => `${x.medal ?? 'finish'} ${x.prize}`).join(', '));
  check('unknown stage', prizeFor('Ingenstans', 50).prize === FINISH_PRIZE, 'finish prize');
}

// 3. Upgrades change the car, but not the base car.
{
  const base = kvarn240();
  const engine = { airfilter: 1, exhaust: 1, racecat: 1, cams: 1, pistons: 1 };
  const tuned = applyUpgrades(base, { ...engine, pads: 1, rallytyres: 1 });
  check('upgrades', tuned.engine.curveNm[3]! > base.engine.curveNm[3]! * 1.1 && tuned.engine.limiterRpm > base.engine.limiterRpm && tuned.brake.total > base.brake.total && tuned.gripScale > base.gripScale && kvarn240().engine.curveNm[3] === base.engine.curveNm[3], `${base.engine.curveNm[3]} → ${tuned.engine.curveNm[3]!.toFixed(0)} Nm`);
  const s0 = carSpecs(base);
  const s3 = carSpecs(applyUpgrades(base, engine));
  check('engine makes the car faster', s3.zeroTo100 < s0.zeroTo100 - 0.3, `0–100 ${s0.zeroTo100.toFixed(1)} → ${s3.zeroTo100.toFixed(1)} s`);
}

// 3b. Old levelled upgrades are refunded.
{
  const old = { ...newCareer(), garage: { [CAR]: { upgrades: { engine: 2, tyres: 1, pads: 1 } } } };
  const m = migrateCareer(old);
  check('old upgrades refunded', m.money === START_MONEY + 2000 + 4500 + 1500 && JSON.stringify(m.garage[CAR]!.upgrades) === '{"pads":1}' && migrateCareer(m) === m, `${m.money} kr`);
}

// 3c. Renamed cars move to their new names in the garage and the history.
{
  const old = {
    ...newCareer(),
    garage: { 'Kvarn Turbo 4x4': { upgrades: {} }, 'Strand 2.0 GT': { upgrades: {} } },
    history: [
      { kind: 'car' as const, at: 1, name: 'Kvarn Turbo 4x4', amount: -50000 },
      { kind: 'stage' as const, at: 2, name: 'Myrkulla', car: 'Strand 2.0 GT', amount: 900 },
    ],
  };
  const m = migrateCareer(old);
  const ok =
    JSON.stringify(Object.keys(m.garage)) === '["Strand 2.0 Turbo 4x4","Strand 1800"]' &&
    m.history![0]!.name === 'Strand 2.0 Turbo 4x4' && m.history![1]!.car === 'Strand 1800' && m.history![1]!.name === 'Myrkulla' &&
    m.money === old.money && migrateCareer(m) === m;
  check('renamed cars move over', ok, Object.keys(m.garage).join(', '));
}

// 4. Sync: the career is validated and the latest change wins.
{
  const old: Stamped = [JSON.stringify(newCareer()), 100];
  const fresh: Stamped = [JSON.stringify({ ...newCareer(), money: 9000 }), 200];
  check('latest career wins', replaces(CAREER_KEY, fresh, old) && !replaces(CAREER_KEY, old, fresh), 'ok');
  const clean = sanitize({ [CAREER_KEY]: old, careerx: old });
  const bad = sanitize({ [CAREER_KEY]: [JSON.stringify({ money: -5, garage: {} }), 1] });
  check('career sanitized', Object.keys(clean).join() === CAREER_KEY && Object.keys(bad).length === 0 && !isCareerState({ money: 1.5, garage: {} }), Object.keys(clean).join());
}

// 5. Championships: thresholds, prizes, repairs and progress.
{
  const def = CHAMPIONSHIPS[0]!;
  const legsExist = CHAMPIONSHIPS.every((c) => c.legs.every((name) => STAGES.some((s) => s.name === name)) && !!championshipTargets(c));
  const targets = championshipTargets(def);
  check('championship: stages and thresholds', legsExist && !!targets && targets[0] === def.legs.reduce((sum, leg) => sum + STAGE_TARGETS[leg]![0], 0) && def.legs.length === 3 && STAGES.every((s) => CHAMPIONSHIPS.some((c) => c.legs.includes(s.name))), `${CHAMPIONSHIPS.length} championships, ${def.legs.join(' + ')}: gold under ${targets?.[0]} s`);
  const prizes = [1, 2, 3, 4].map((place) => championshipPrize(def, place, 'medium'));
  check('championship: prize money', prizes.map((p) => p.medal).join() === 'guld,silver,brons,' && prizes[0]!.prize > prizes[1]!.prize && prizes[2]!.prize > prizes[3]!.prize && prizes[0]!.prize % 500 === 0, prizes.map((p) => `${p.medal ?? 'finish'} ${p.prize}`).join(', '));
  const byDifficulty = (['easy', 'medium', 'hard'] as const).map((d) => championshipPrize(def, 1, d).prize);
  check('championship: prize money per difficulty', byDifficulty.join() === '15500,20500,25500' && difficultyOf(newProgress(def, 'Kvarn 240 GL', 1, 'hard')) === 'hard' && difficultyOf({ id: def.id, car: 'Kvarn 240 GL', leg: 0, times: [], damage: null }) === 'easy', byDifficulty.join(' / '));
  const rewon = [1, 4].map((place) => championshipPrize(def, place, 'easy', true).prize);
  check('championship: repeat wins pay less', rewon[0] === 6000 && rewon[1] === championshipPrize(def, 4, 'easy').prize, `win again ${rewon[0]} kr, finish ${rewon[1]} kr`);
  const none: CarDamage = { body: { front: 0, rear: 0, left: 0, right: 0, roof: 0 }, wheels: [0, 0, 0, 0], powerFactor: 1 };
  const crashed: CarDamage = { body: { front: 0.6, rear: 0, left: 0.2, right: 0, roof: 0 }, wheels: [0.3, 0, 0, 0], powerFactor: 0.76 };
  const noLamp: CarDamage = { ...crashed, lamps: [0.6, 0] };
  check('championship: repair cost', repairCost(none) === 0 && repairCost(crashed) === 2400 && repairCost(noLamp) === 2750, `${repairCost(crashed)} kr, with broken lamp ${repairCost(noLamp)} kr`);
  const lampsFixed = repairPart(noLamp, 'lamps');
  check('championship: repair one part', repairCost(lampsFixed) === 2400 && lampsFixed.powerFactor === 0.76 && repairCost(repairPart(repairPart(repairPart(lampsFixed, 'body'), 'wheels'), 'engine')) === 0, `lamps for ${repairCost(noLamp) - repairCost(lampsFixed)} kr`);
  const start = { id: def.id, car: 'Kvarn 240 GL', leg: 0, times: [], damage: null };
  const next = afterLeg(start, 91.2, crashed, false);
  const fixed = afterLeg(start, 91.2, crashed, true);
  check('championship: progress', isProgress(start) && isProgress(next) && next.leg === 1 && next.damage === crashed && fixed.damage === null && !isProgress({ ...next, leg: 3, times: [1, 2, 3] }) && isProgress(afterLeg(start, 91.2, noLamp, false)) && !isProgress(afterLeg(start, 91.2, { ...noLamp, lamps: [2, 0] }, false)) && !isProgress({ ...start, id: 'okänt' }), `stage ${next.leg + 1}, times ${next.times.join()}`);
}

// 6. Rivals: driving at gold pace fights for the podium, driving much faster than gold
// usually but not always wins, and driving at bronze pace almost never wins.
{
  const def = CHAMPIONSHIPS[0]!;
  const fresh = newProgress(def, 'Kvarn 240 GL', 42);
  const names = new Set(fresh.rivals!.map((v) => v.name));
  check('rivals: a field', fresh.rivals!.length === RIVAL_COUNT && names.size === RIVAL_COUNT && Math.min(...fresh.rivals!.map((v) => v.pace)) <= 1 && isProgress(fresh), [...names].slice(0, 3).join(', ') + ' …');
  const run = (pace: number, seed: number, d = def) => {
    let p = newProgress(d, 'Kvarn 240 GL', seed);
    for (const leg of d.legs) {
      const time = STAGE_TARGETS[leg]![0] * pace;
      p = afterLeg(raceRivals(p, time), time, { body: { front: 0, rear: 0, left: 0, right: 0, roof: 0 }, wheels: [0, 0, 0, 0], powerFactor: 1 }, true);
    }
    return { place: standings(p.rivals!, p.times).findIndex((s) => s.player) + 1, valid: isProgress({ ...p, leg: p.leg - 1, times: p.times.slice(0, -1), rivals: p.rivals!.map((v) => ({ ...v, times: v.times.slice(0, -1) })) }) };
  };
  const winRate = (pace: number, d = def) => {
    const results = Array.from({ length: 300 }, (_, seed) => run(pace, seed, d));
    return { wins: results.filter((r) => r.place === 1).length / results.length, podium: results.filter((r) => r.place <= 3).length / results.length, valid: results.every((r) => r.valid) };
  };
  const gold = winRate(1);
  // The field does not follow the player below the floor, so a faster car pays off: in Vinterrallyt
  // gold pace is not enough, but 5 % under gold wins more often than not.
  const fast = winRate(0.9);
  const slow = winRate(1.25);
  const winter = CHAMPIONSHIPS[2]!;
  const winterGold = winRate(1, winter);
  const winterFast = winRate(0.95, winter);
  const ok = gold.valid && gold.wins > 0.05 && gold.wins < 0.5 && gold.podium > 0.4 && fast.wins > 0.8 && slow.wins < 0.02 && winterGold.wins < 0.2 && winterFast.wins > 0.5;
  check('rivals: challenging but winnable', ok, `wins at gold pace ${(gold.wins * 100).toFixed(0)} % (podium ${(gold.podium * 100).toFixed(0)} %), 10 % faster ${(fast.wins * 100).toFixed(0)} %, bronze pace ${(slow.wins * 100).toFixed(0)} %; winter at gold pace ${(winterGold.wins * 100).toFixed(0)} %, 5 % faster ${(winterFast.wins * 100).toFixed(0)} %`);
  // Weather: the same seed gives the same weather, and the rivals drive slower in rain.
  const same = def.legs.every((_, i) => legWeather(fresh, i) === legWeather({ ...fresh }, i));
  const dryLeg = raceLeg(fresh.rivals!, def.legs, 0, [90], 7)[0]!.times[0]!;
  const wetLeg = raceLeg(fresh.rivals!, def.legs, 0, [90], 7, [1.05])[0]!.times[0]!;
  check('rivals: weather', same && wetLeg > dryLeg * 1.03, `dry ${dryLeg.toFixed(1)} s, rain ${wetLeg.toFixed(1)} s`);
  // Old progress without rivals gets a field afterwards.
  const old = { id: def.id, car: 'Kvarn 240 GL', leg: 1, times: [91], damage: null };
  const caught = raceRivals(old, 94);
  check('rivals: old progress', caught.rivals!.length === RIVAL_COUNT && caught.rivals!.every((v) => v.times.length === 2), `${caught.rivals![0]!.times.join(', ')}`);
  // Start order: the newcomer last on the first stage, then reverse standings; the times ahead of you match the finish.
  const leg0 = aheadOnRoad(fresh);
  const lead = afterLeg(raceRivals(fresh, 60), 60, { body: { front: 0, rear: 0, left: 0, right: 0, roof: 0 }, wheels: [0, 0, 0, 0], powerFactor: 1 }, true);
  const trail = afterLeg(raceRivals(fresh, 999), 999, { body: { front: 0, rear: 0, left: 0, right: 0, roof: 0 }, wheels: [0, 0, 0, 0], powerFactor: 1 }, true);
  const ahead = aheadOnRoad(lead);
  const after = raceRivals(lead, 60).rivals!;
  const same0 = leg0.every((a) => raceRivals(fresh, 60).rivals!.find((v) => v.name === a.name)!.times[0] === a.time);
  const same1 = ahead.every((a) => after.find((v) => v.name === a.name)!.times[1] === a.time);
  check('start order', leg0.length === RIVAL_COUNT && same0 && startOrder(lead).at(-1) === 'Du' && ahead.length === RIVAL_COUNT && same1 && startOrder(trail)[0] === 'Du' && aheadOnRoad(trail).length === 0, startOrder(lead).join(', '));
  const fastest = (d: 'easy' | 'medium' | 'hard') => Math.min(...newProgress(def, kvarn240.name, 7, d).rivals!.map((v) => v.pace));
  const hard = newProgress(def, kvarn240.name, 7, 'hard');
  check('rivals: difficulty', fastest('hard') < fastest('medium') && fastest('medium') < fastest('easy') && isProgress(hard) && raceRivals(hard, 90).rivals![0]!.times.length === 1 && !isProgress({ ...hard, difficulty: 0.5 }), `${fastest('easy').toFixed(3)} / ${fastest('medium').toFixed(3)} / ${fastest('hard').toFixed(3)}`);
}

// History: purchases are logged, the list is capped and broken rows are rejected.
{
  const c = buyUpgrade(buyCar(newCareer(), CAR) as ReturnType<typeof newCareer>, CAR, 'pads') as ReturnType<typeof newCareer>;
  const kinds = c.history!.map((e) => `${e.kind}:${e.amount}`).join(', ');
  check('history: purchases logged', kinds === 'car:-6000, upgrade:-1000' && isCareerState(c), kinds);
  let full = c;
  for (let i = 0; i < MAX_HISTORY + 5; i++) full = logged(full, { kind: 'stage', name: 'Skogsberg', car: CAR, time: 90 + i, medal: null, amount: 250 });
  check('history: capped', full.history!.length === MAX_HISTORY && full.history!.at(-1)!.time === 90 + MAX_HISTORY + 4 && isCareerState(full), `${full.history!.length} rows`);
  const bad = { ...c, history: [{ kind: 'stage', at: 1, name: '', amount: 0 }] };
  check('history: sanitized', !isCareerState(bad) && !isCareerState({ ...c, history: [{ ...c.history![0]!, amount: 1.5 }] }), 'rejected');
}

// Championships unlock in order; old wins in the history count.
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
  const ok = open(fresh) === '1000000' && open(one) === '1100000' && open(myrOnly) === '1000000' && open(both) === '1110000' && open(old) === '1100000' && open(second) === '1000000';
  check('championship: unlocking', ok && withWin(one, skog) === one && isCareerState(both) && !isCareerState({ ...fresh, won: [''] }), `${open(fresh)} ${open(one)} ${open(both)}`);
}

// Class 2: unlocked by all class 1 championships, has its own parts, tighter thresholds and bigger prizes.
{
  const tier1 = CHAMPIONSHIPS.filter((c) => c.tier === 1);
  const tier2 = CHAMPIONSHIPS.filter((c) => c.tier === 2);
  const allOne = tier1.reduce(withWin, newCareer());
  const almost = tier1.slice(0, 2).reduce(withWin, newCareer());
  const openTwo = (c: ReturnType<typeof newCareer>) => tier2.map((ch) => (championshipUnlocked(c, ch) ? 1 : 0)).join('');
  // Forsrallyt was added after class 2 and is not needed to unlock it.
  const firstThree = tier1.slice(0, 3).reduce(withWin, newCareer());
  const fors = CHAMPIONSHIPS.find((c) => c.id === 'forsrallyt')!;
  check('forsrallyt: unlocked by vinterrallyt', !championshipUnlocked(almost, fors) && championshipUnlocked(firstThree, fors) && tierUnlocked(firstThree, 2), `${tier1.length} championships in class 1`);
  check('class 2: unlocking', !tierUnlocked(almost, 2) && tierUnlocked(allOne, 2) && tierUnlocked(newCareer(), 1) && openTwo(almost) === '000' && openTwo(allOne) === '100' && openTwo(withWin(allOne, tier2[0]!)) === '110', `${openTwo(almost)} → ${openTwo(allOne)}`);
  const tall = tier2[0]!;
  check('unlock hint: first in class names class 1', unlockHint(newCareer(), tall) === 'vinn Vinterrallyt' && unlockHint(almost, tall) === 'vinn Vinterrallyt' && unlockHint(allOne, tier2[1]!) === `vinn ${tall.name}` && unlockHint(newCareer(), CHAMPIONSHIPS[1]!) === 'vinn Skogsrallyt', unlockHint(newCareer(), tall));
  const allTwo = tier2.reduce(withWin, allOne);
  check('late cars: require class 2 won', carUnlocked(allOne, 'Strand 2.0 Turbo 4x4') && !carUnlocked(allOne, 'Sora 2.0 Turbo') && !carUnlocked(withWin(allOne, tier2[0]!), 'Hoshi 2.0 4WD') && carUnlocked(allTwo, 'Sora 2.0 Turbo') && carUnlocked(allTwo, 'Brenner 5T Coupé') && !carUnlocked(almost, 'Volpe 2.0 Turbo 16V'), `${tier2.length} championships in class 2`);
  const names = CARS.map((m) => m.make().name);
  check('class 2: seven cars', names.filter((n) => tierOf(n) === 2).length === 7 && names.every((n) => tierOf(n) === 1 || tierOf(n) === 2), names.map((n) => `${n} ${tierOf(n)}`).join(', '));
  const T2 = 'Strand 2.0 Turbo 4x4';
  const rich = buyCar(buyCar({ ...newCareer(), money: 200_000 }, T2) as ReturnType<typeof newCareer>, CAR) as ReturnType<typeof newCareer>;
  const own = upgradesFor(T2).map((u) => u.id);
  const ids = new Set([...upgradesFor(CAR), ...upgradesFor(T2)].map((u) => u.id));
  const ok = own.length >= 8 && ids.size === upgradesFor(CAR).length + own.length && buyUpgrade(rich, T2, 'exhaust') === 'unknown' && buyUpgrade(rich, CAR, 'dogbox') === 'unknown' && typeof buyUpgrade(rich, T2, 'dogbox') === 'object';
  check('class 2: own parts', ok, own.join(', '));
  const base = strandTurbo4x4();
  const built = applyUpgrades(base, Object.fromEntries(own.map((id) => [id, 1])));
  check('class 2: parts take effect', built.mass === base.mass - 50 && built.gearbox.shiftTime < base.gearbox.shiftTime && built.brake.handbrake > base.brake.handbrake && built.engine.inertia < base.engine.inertia && built.gripScale > base.gripScale, `${base.mass} → ${built.mass} kg`);
  // Parts by drivetrain, engine and car.
  const has = (car: string, id: string) => upgradesFor(car).some((u) => u.id === id);
  const B = 'Brenner 5T Coupé';
  const fit =
    !has(B, 'platelsd') && has('Strand 1800', 'platelsd') && has(B, 'centerdiff') && !has('Strand 1800', 'centerdiff') &&
    has('Hoshi 2.0 4WD', 'antilag') && !has('Ljung 2000 16V', 'antilag') && has('Ljung 2000 16V', 'throttles') && !has(B, 'throttles') &&
    has(B, 'bigturbo') && has(B, 'kevlar') && !has('Sora 2.0 Turbo', 'bigturbo');
  const single = (id: string, car: string) => CARS.map((m) => m.make().name).filter((n) => has(n, id)).join() === car;
  const fitMore =
    has('Kvarn 240 Turbo', 'wastegate') && !has(CAR, 'wastegate') && !has('Strand 2.0 Turbo 4x4', 'wastegate') &&
    single('headers', 'Sora 2.0 Turbo') && single('shortfinal', 'Hoshi 2.0 4WD') && single('lightrear', 'Volpe 2.0 Turbo 16V') && single('sequential', 'Ljung 2000 16V');
  check('single-car and turbo parts in class 1', fitMore, upgradesFor('Kvarn 240 Turbo').map((u) => u.id).join(', '));
  check('class 2: parts by car', fit, upgradesFor(B).map((u) => u.id).join(', '));
  const stale = migrateCareer({ ...newCareer(), garage: { [B]: { upgrades: { platelsd: 1, dogbox: 1 } } } });
  check('parts that no longer fit are refunded', stale.money === START_MONEY + 7000 && JSON.stringify(stale.garage[B]!.upgrades) === '{"dogbox":1}' && migrateCareer(stale) === stale, `${stale.money} kr`);
  const bBase = CARS.find((m) => m.make().name === B)!.make();
  const quattro = applyUpgrades(bBase, Object.fromEntries(upgradesFor(B).map((u) => [u.id, 1])));
  const peak = (p: typeof bBase) => Math.max(...p.engine.curveNm);
  check('brenner fully built', quattro.mass === bBase.mass - 140 && peak(quattro) > peak(bBase) * 1.5 && quattro.frontShare < bBase.frontShare && applyUpgrades(bBase, { platelsd: 1 }).diff.lock === bBase.diff.lock && quattro.engine.turbo!.antilag > 0 && quattro.engine.turbo!.spool > bBase.engine.turbo!.spool, `${peak(bBase)} → ${Math.round(peak(quattro))} Nm, ${quattro.mass} kg`);
  // The same time just under class 1 gold earns silver in class 2; gold there needs 8 % faster.
  const g1 = STAGE_TARGETS.Grinsbol![0];
  const gold1 = prizeFor('Grinsbol', g1 - 2, 1);
  const slow2 = prizeFor('Grinsbol', g1 - 2, 2);
  const gold2 = prizeFor('Grinsbol', Math.round(g1 * 0.92) - 1, 2);
  check('class 2: thresholds and prizes', gold1.medal === 'guld' && slow2.medal === 'silver' && gold2.medal === 'guld' && gold2.prize === MEDALS[0].prize * 2 && championshipPrize(tier2[0]!, 1, 'medium').prize === championshipPrize({ ...tier2[0]!, tier: 1 }, 1, 'medium').prize * 2, `${g1 - 2} s: class 1 ${gold1.medal}, class 2 ${slow2.medal}; ${Math.round(g1 * 0.92) - 1} s class 2 ${gold2.medal} ${gold2.prize} kr`);
  // The same stages in class 1 thresholds: the sum of the gold times.
  const t1 = tier2[0]!.legs.reduce((sum, leg) => sum + STAGE_TARGETS[leg]![0], 0);
  const t2 = championshipTargets(tier2[0]!)![0];
  check('class 2: faster field', tier2.every((c) => !!championshipTargets(c)) && t2 < t1 && Math.min(...newProgress(tier2[0]!, T2, 1).rivals!.map((v) => v.pace)) < 0.95, `gold ${t1} s vs ${t2} s`);
}

{
  const ch = CHAMPIONSHIPS[0]!;
  const entry = (place: number) => ({ kind: 'championship' as const, at: 0, name: ch.name, place, of: RIVAL_COUNT + 1, amount: 0 });
  const raced = { ...newCareer(), history: [entry(4), entry(2), entry(5)] };
  const won = withWin(newCareer(), ch);
  check('best position', bestPlace(newCareer(), ch) === null && bestPlace(raced, ch) === 2 && bestPlace(won, ch) === 1, `${bestPlace(raced, ch)}, ${bestPlace(won, ch)}`);
}

// Weekly challenge: the same for everyone, varies between weeks, paid out once.
{
  const week = weekOf(Date.UTC(2026, 10, 30, 12));
  const a = weeklyChallenge(week);
  const b = weeklyChallenge(week);
  const weeks = Array.from({ length: 20 }, (_, i) => weeklyChallenge(week + i));
  check('weekly: same challenge for the same week', a.stage === b.stage && a.model === b.model && a.weather === b.weather, `${a.stage.name}, ${a.model.make().name}, ${a.weather}`);
  check('weekly: varies between weeks', new Set(weeks.map((w) => w.stage.name)).size >= 8 && new Set(weeks.map((w) => w.model)).size >= 5, `${new Set(weeks.map((w) => w.stage.name)).size} stages, ${new Set(weeks.map((w) => w.model)).size} cars in 20 weeks`);
  check('weekly: weeks run Monday to Monday UTC', weekOf(Date.UTC(2026, 10, 30)) === weekOf(Date.UTC(2026, 11, 6, 23, 59)) && weekOf(Date.UTC(2026, 11, 7)) === week + 1 && weekEnd(week) === Date.UTC(2026, 11, 7), `week ${week}`);
  const career = { money: 1000, garage: {} };
  const won = settleWeek(career, week, { place: 1, time: 200 }, 12, 0);
  const away = settleWeek(career, week, null, 12, 0);
  check('weekly: placing pays out once', won.money === 1000 + weeklyPrize(1) && won.weeklyPaid === week && won.history?.length === 1 && away.money === 1000 && away.weeklyPaid === week && weeklyPrize(4) === 3000 && weeklyPrize(11) === 1500 && isCareerState(won), `win +${won.money - 1000} kr, away +0`);
  // A run along the road at a steady pace, recorded as the game does (20 Hz ghost frames).
  const road = new Stage(a.stage);
  const runAt = (pace: number, shift = 0) => {
    const time = (road.finish - START_S) / pace;
    const frames: number[] = [];
    for (let t = 0; t <= time; t += 1 / 20) {
      const i = Math.min(road.xs.length - 1, Math.round(START_S + pace * t));
      frames.push(road.xs[i]! + shift, 0, road.zs[i]!, 0, 0, 0, 1);
    }
    return { time, trace: traceOf({ hz: 20, frames }) };
  };
  const gold = stageTargets(a.stage.name, tierOf(a.model.make().name))![0];
  const fair = runAt((road.finish - START_S) / (gold * 1.05));
  const fast = runAt((road.finish - START_S) / (gold * 0.7));
  const offRoad = runAt((road.finish - START_S) / (gold * 1.05), 80);
  const cut = { ...fair, trace: fair.trace.map((v, i) => (i === 2 * 100 ? v + 3000 : i === 2 * 101 ? v - 3000 : v)) };
  const short = { ...fair, trace: fair.trace.slice(0, fair.trace.length / 2) };
  check('weekly: run check', checkRun(a, fair.time, fair.trace) === 'ok' && checkRun(a, fast.time, fast.trace) === 'too-fast' && checkRun(a, offRoad.time, offRoad.trace) === 'bad-trace' && checkRun(a, short.time, short.trace) === 'bad-trace' && checkRun(a, fair.time + 30, fair.trace) === 'bad-trace' && checkRun(a, fair.time, [1.5, 2]) === 'bad-trace' && checkRun(a, cut.time, cut.trace) === 'bad-trace', `${(JSON.stringify(fair.trace).length / 1024).toFixed(1)} kB for ${fair.time.toFixed(0)} s at ${TRACE_HZ} Hz`);
  check('weekly: driver names never contain HTML', isDriverName('Simon') && isDriverName('Åsa 2') && !isDriverName('<b>x</b>') && !isDriverName(' x') && !isDriverName('a') && !isDriverName('a'.repeat(17)) && !isCareerState({ ...career, driver: '<i>' }), 'checked');
}

if (failures) {
  console.log(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log('\nAll career tests passed');
