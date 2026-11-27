import { CAREER_KEY, isCareerState, MAX_HISTORY, replaces, sanitize, type Stamped } from '../src/account/protocol';
import { applyUpgrades, buyCar, logged, migrateCareer, buyUpgrade, claimDailyBonus, DAILY_BONUS, FINISH_PRIZE, MEDALS, newCareer, prizeFor, START_MONEY, tierOf, upgradesFor } from '../src/career/career';
import { afterLeg, bestPlace, carUnlocked, CHAMPIONSHIPS, championshipPrize, championshipUnlocked, tierUnlocked, unlockHint, withWin, championshipTargets, isProgress, legWeather, newProgress, raceRivals, repairCost, repairPart, type CarDamage } from '../src/career/championship';
import { raceLeg, RIVAL_COUNT, standings } from '../src/career/rivals';
import { STAGE_TARGETS } from '../src/career/career';
import { CARS, kvarn240, kvarnTurbo4x4 } from '../src/physics/params';
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
  const [g, sv, b] = STAGE_TARGETS.Grinsbol!;
  const p = [g - 1, sv - 1, b - 1, b + 10].map((t) => prizeFor('Grinsbol', t));
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
  check('mästerskap: etapper och gränser', legsExist && !!targets && targets[0] === def.legs.reduce((sum, leg) => sum + STAGE_TARGETS[leg]![0], 0) && def.legs.length === 3 && STAGES.every((s) => CHAMPIONSHIPS.some((c) => c.legs.includes(s.name))), `${CHAMPIONSHIPS.length} mästerskap, ${def.legs.join(' + ')}: guld under ${targets?.[0]} s`);
  const prizes = [1, 2, 3, 4].map((place) => championshipPrize(def, place));
  check('mästerskap: prispengar', prizes.map((p) => p.medal).join() === 'guld,silver,brons,' && prizes[0]!.prize > prizes[1]!.prize && prizes[2]!.prize > prizes[3]!.prize && prizes[0]!.prize % 500 === 0, prizes.map((p) => `${p.medal ?? 'mål'} ${p.prize}`).join(', '));
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
  // Fältet följer inte spelaren under golvet, så en snabbare bil lönar sig: i Vinterrallyt räcker
  // guldfart inte, men 5 % under guld vinner oftare än inte.
  const fast = winRate(0.9);
  const slow = winRate(1.25);
  const winter = CHAMPIONSHIPS[2]!;
  const winterGold = winRate(1, winter);
  const winterFast = winRate(0.95, winter);
  const ok = gold.valid && gold.wins > 0.05 && gold.wins < 0.5 && gold.podium > 0.4 && fast.wins > 0.8 && slow.wins < 0.02 && winterGold.wins < 0.2 && winterFast.wins > 0.5;
  check('motståndare: utmaning men går att vinna', ok, `vinst i guldfart ${(gold.wins * 100).toFixed(0)} % (pall ${(gold.podium * 100).toFixed(0)} %), 10 % snabbare ${(fast.wins * 100).toFixed(0)} %, bronsfart ${(slow.wins * 100).toFixed(0)} %; vinter i guldfart ${(winterGold.wins * 100).toFixed(0)} %, 5 % snabbare ${(winterFast.wins * 100).toFixed(0)} %`);
  // Väder: samma frö ger samma väder, och motståndarna kör långsammare i regn.
  const same = def.legs.every((_, i) => legWeather(fresh, i) === legWeather({ ...fresh }, i));
  const dryLeg = raceLeg(fresh.rivals!, def.legs, 0, [90], 7)[0]!.times[0]!;
  const wetLeg = raceLeg(fresh.rivals!, def.legs, 0, [90], 7, [1.05])[0]!.times[0]!;
  check('motståndare: väder', same && wetLeg > dryLeg * 1.03, `torrt ${dryLeg.toFixed(1)} s, regn ${wetLeg.toFixed(1)} s`);
  // Gammalt framsteg utan motståndare får ett fält i efterhand.
  const old = { id: def.id, car: 'Kvarn 240 GL', leg: 1, times: [91], damage: null };
  const caught = raceRivals(old, 94);
  check('motståndare: gammalt framsteg', caught.rivals!.length === RIVAL_COUNT && caught.rivals!.every((v) => v.times.length === 2), `${caught.rivals![0]!.times.join(', ')}`);
  const fastest = (d: 'easy' | 'medium' | 'hard') => Math.min(...newProgress(def, kvarn240.name, 7, d).rivals!.map((v) => v.pace));
  const hard = newProgress(def, kvarn240.name, 7, 'hard');
  check('motståndare: svårighetsgrad', fastest('hard') < fastest('medium') && fastest('medium') < fastest('easy') && isProgress(hard) && raceRivals(hard, 90).rivals![0]!.times.length === 1 && !isProgress({ ...hard, difficulty: 0.5 }), `${fastest('easy').toFixed(3)} / ${fastest('medium').toFixed(3)} / ${fastest('hard').toFixed(3)}`);
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
  const ok = open(fresh) === '1000000' && open(one) === '1100000' && open(myrOnly) === '1000000' && open(both) === '1110000' && open(old) === '1100000' && open(second) === '1000000';
  check('mästerskap: upplåsning', ok && withWin(one, skog) === one && isCareerState(both) && !isCareerState({ ...fresh, won: [''] }), `${open(fresh)} ${open(one)} ${open(both)}`);
}

// Klass 2: låses upp av alla klass 1-mästerskap, har egna delar, snävare gränser och större priser.
{
  const tier1 = CHAMPIONSHIPS.filter((c) => c.tier === 1);
  const tier2 = CHAMPIONSHIPS.filter((c) => c.tier === 2);
  const allOne = tier1.reduce(withWin, newCareer());
  const almost = tier1.slice(0, 2).reduce(withWin, newCareer());
  const openTwo = (c: ReturnType<typeof newCareer>) => tier2.map((ch) => (championshipUnlocked(c, ch) ? 1 : 0)).join('');
  // Forsrallyt kom till efter klass 2 och behövs inte för att öppna den.
  const firstThree = tier1.slice(0, 3).reduce(withWin, newCareer());
  const fors = CHAMPIONSHIPS.find((c) => c.id === 'forsrallyt')!;
  check('forsrallyt: öppnas av vinterrallyt', !championshipUnlocked(almost, fors) && championshipUnlocked(firstThree, fors) && tierUnlocked(firstThree, 2), `${tier1.length} mästerskap i klass 1`);
  check('klass 2: upplåsning', !tierUnlocked(almost, 2) && tierUnlocked(allOne, 2) && tierUnlocked(newCareer(), 1) && openTwo(almost) === '000' && openTwo(allOne) === '100' && openTwo(withWin(allOne, tier2[0]!)) === '110', `${openTwo(almost)} → ${openTwo(allOne)}`);
  const tall = tier2[0]!;
  check('upplåsningstips: klassens första nämner klass 1', unlockHint(newCareer(), tall) === 'vinn Vinterrallyt' && unlockHint(almost, tall) === 'vinn Vinterrallyt' && unlockHint(allOne, tier2[1]!) === `vinn ${tall.name}` && unlockHint(newCareer(), CHAMPIONSHIPS[1]!) === 'vinn Skogsrallyt', unlockHint(newCareer(), tall));
  const allTwo = tier2.reduce(withWin, allOne);
  check('sena bilar: kräver klass 2 vunnen', carUnlocked(allOne, 'Kvarn Turbo 4x4') && !carUnlocked(allOne, 'Sora 2.0 Turbo') && !carUnlocked(withWin(allOne, tier2[0]!), 'Hoshi 2.0 4WD') && carUnlocked(allTwo, 'Sora 2.0 Turbo') && carUnlocked(allTwo, 'Brenner 5T Coupé') && !carUnlocked(almost, 'Volpe 2.0 Turbo 16V'), `${tier2.length} mästerskap i klass 2`);
  const names = CARS.map((m) => m.make().name);
  check('klass 2: sju bilar', names.filter((n) => tierOf(n) === 2).length === 7 && names.every((n) => tierOf(n) === 1 || tierOf(n) === 2), names.map((n) => `${n} ${tierOf(n)}`).join(', '));
  const T2 = 'Kvarn Turbo 4x4';
  const rich = buyCar(buyCar({ ...newCareer(), money: 200_000 }, T2) as ReturnType<typeof newCareer>, CAR) as ReturnType<typeof newCareer>;
  const own = upgradesFor(T2).map((u) => u.id);
  const ids = new Set([...upgradesFor(CAR), ...upgradesFor(T2)].map((u) => u.id));
  const ok = own.length >= 8 && ids.size === upgradesFor(CAR).length + own.length && buyUpgrade(rich, T2, 'exhaust') === 'unknown' && buyUpgrade(rich, CAR, 'dogbox') === 'unknown' && typeof buyUpgrade(rich, T2, 'dogbox') === 'object';
  check('klass 2: egna delar', ok, own.join(', '));
  const base = kvarnTurbo4x4();
  const built = applyUpgrades(base, Object.fromEntries(own.map((id) => [id, 1])));
  check('klass 2: delarna verkar', built.mass === base.mass - 50 && built.gearbox.shiftTime < base.gearbox.shiftTime && built.brake.handbrake > base.brake.handbrake && built.engine.inertia < base.engine.inertia && built.gripScale > base.gripScale, `${base.mass} → ${built.mass} kg`);
  // Delar efter drivlina, motor och bil.
  const has = (car: string, id: string) => upgradesFor(car).some((u) => u.id === id);
  const B = 'Brenner 5T Coupé';
  const fit =
    !has(B, 'platelsd') && has('Strand 2.0 GT', 'platelsd') && has(B, 'centerdiff') && !has('Strand 2.0 GT', 'centerdiff') &&
    has('Hoshi 2.0 4WD', 'antilag') && !has('Ljung 2000 16V', 'antilag') && has('Ljung 2000 16V', 'throttles') && !has(B, 'throttles') &&
    has(B, 'bigturbo') && has(B, 'kevlar') && !has('Sora 2.0 Turbo', 'bigturbo');
  const single = (id: string, car: string) => CARS.map((m) => m.make().name).filter((n) => has(n, id)).join() === car;
  const fitMore =
    has('Kvarn 240 Turbo', 'wastegate') && !has(CAR, 'wastegate') && !has('Kvarn Turbo 4x4', 'wastegate') &&
    single('headers', 'Sora 2.0 Turbo') && single('shortfinal', 'Hoshi 2.0 4WD') && single('lightrear', 'Volpe 2.0 Turbo 16V') && single('sequential', 'Ljung 2000 16V');
  check('delar till en bil och turbo i klass 1', fitMore, upgradesFor('Kvarn 240 Turbo').map((u) => u.id).join(', '));
  check('klass 2: delar efter bil', fit, upgradesFor(B).map((u) => u.id).join(', '));
  const stale = migrateCareer({ ...newCareer(), garage: { [B]: { upgrades: { platelsd: 1, dogbox: 1 } } } });
  check('delar som inte passar återbetalas', stale.money === START_MONEY + 7000 && JSON.stringify(stale.garage[B]!.upgrades) === '{"dogbox":1}' && migrateCareer(stale) === stale, `${stale.money} kr`);
  const bBase = CARS.find((m) => m.make().name === B)!.make();
  const quattro = applyUpgrades(bBase, Object.fromEntries(upgradesFor(B).map((u) => [u.id, 1])));
  const peak = (p: typeof bBase) => Math.max(...p.engine.curveNm);
  check('brenner fullt byggd', quattro.mass === bBase.mass - 140 && peak(quattro) > peak(bBase) * 1.5 && quattro.frontShare < bBase.frontShare && applyUpgrades(bBase, { platelsd: 1 }).diff.lock === bBase.diff.lock && quattro.engine.turbo!.antilag > 0 && quattro.engine.turbo!.spool > bBase.engine.turbo!.spool, `${peak(bBase)} → ${Math.round(peak(quattro))} Nm, ${quattro.mass} kg`);
  // Samma tid strax under klass 1-guld räcker till silver i klass 2; guld där kräver 8 % snabbare.
  const g1 = STAGE_TARGETS.Grinsbol![0];
  const gold1 = prizeFor('Grinsbol', g1 - 2, 1);
  const slow2 = prizeFor('Grinsbol', g1 - 2, 2);
  const gold2 = prizeFor('Grinsbol', Math.round(g1 * 0.92) - 1, 2);
  check('klass 2: gränser och priser', gold1.medal === 'guld' && slow2.medal === 'silver' && gold2.medal === 'guld' && gold2.prize === MEDALS[0].prize * 2 && championshipPrize(tier2[0]!, 1).prize === championshipPrize({ ...tier2[0]!, tier: 1 }, 1).prize * 2, `${g1 - 2} s: klass 1 ${gold1.medal}, klass 2 ${slow2.medal}; ${Math.round(g1 * 0.92) - 1} s klass 2 ${gold2.medal} ${gold2.prize} kr`);
  // Samma etapper i klass 1-gränser: summan av guldtiderna.
  const t1 = tier2[0]!.legs.reduce((sum, leg) => sum + STAGE_TARGETS[leg]![0], 0);
  const t2 = championshipTargets(tier2[0]!)![0];
  check('klass 2: snabbare fält', tier2.every((c) => !!championshipTargets(c)) && t2 < t1 && Math.min(...newProgress(tier2[0]!, T2, 1).rivals!.map((v) => v.pace)) < 0.95, `guld ${t1} s mot ${t2} s`);
}

{
  const ch = CHAMPIONSHIPS[0]!;
  const entry = (place: number) => ({ kind: 'championship' as const, at: 0, name: ch.name, place, of: RIVAL_COUNT + 1, amount: 0 });
  const raced = { ...newCareer(), history: [entry(4), entry(2), entry(5)] };
  const won = withWin(newCareer(), ch);
  check('bästa placering', bestPlace(newCareer(), ch) === null && bestPlace(raced, ch) === 2 && bestPlace(won, ch) === 1, `${bestPlace(raced, ch)}, ${bestPlace(won, ch)}`);
}

if (failures) {
  console.log(`\n${failures} test(er) misslyckades`);
  process.exit(1);
}
console.log('\nAlla karriärtester gick bra');
