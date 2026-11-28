/** The career menus: overview with daily bonus, garage with upgrades, and car dealer. */

import type { CareerState, HistoryEntry } from "../account/protocol";
import { localChanged } from "../account/sync";
import type { PickOptions, Showroom } from "../carSelect";
import { applause, coins, showMenu } from "../menu";
import { confetti } from "../confetti";
import { CHAMPIONSHIP_IMAGES } from "../images";
import { CARS, type CarModel } from "../physics/params";
import { STAGES, type StageDef } from "../physics/stage";
import { pickStage, stagePreviewHtml } from "../stageMenu";
import { rollWeather, WEATHER_NAMES, type Weather } from "../physics/weather";
import type { TyreType } from "../physics/surfaces";
import { forcedWeather, pickTyre } from "../tyreMenu";
import {
  applyUpgrades,
  sponsorsOf,
  buyCar,
  buyUpgrade,
  CAR_PRICES,
  claimDailyBonus,
  formatMoney,
  levelOf,
  localDay,
  logged,
  MEDALS,
  prizeFor,
  stageTargets,
  tierOf,
  TIER_PRIZE,
  upgradesFor,
  type BuyResult,
  type Tier,
} from "./career";
import {
  afterLeg,
  CHAMPIONSHIPS,
  championshipById,
  championshipPrize,
  difficultyOf,
  carUnlocked,
  carUnlockHint,
  championshipUnlocked,
  bestPlace,
  hasWon,
  tierUnlocked,
  unlockHint,
  withWin,
  legWeather,
  newProgress,
  raceRivals,
  championshipKm,
  championshipMedals,
  partCosts,
  repairCost,
  repairPart,
  type RepairPart,
  type CarDamage,
  type ChampionshipDef,
  type ChampionshipProgress,
} from "./championship";
import { RIVAL_COUNT, standings, type Standing } from "./rivals";
import { settings } from "../settings";
import { formatTime, lampStatus } from "../hud";
import {
  loadCareer,
  loadChampionship,
  saveCareer,
  saveChampionship,
} from "./store";

const nameOf = (m: CarModel) => m.make().name;

/** Saves a changed career and syncs it with the account. */
export function commit(career: CareerState) {
  saveCareer(career);
  localChanged();
}

/** Owned cars. The upgrades are read when the car is built, so garage purchases show up immediately. */
function ownedModels(career: CareerState): CarModel[] {
  return CARS.filter((m) => career.garage[nameOf(m)]).map((m) => ({
    ...m,
    make: () =>
      applyUpgrades(m.make(), loadCareer().career.garage[nameOf(m)]!.upgrades),
    sponsors: () => sponsorsOf(loadCareer().career.garage[nameOf(m)]!.upgrades),
  }));
}

type Pick = (
  models: CarModel[],
  opts?: PickOptions,
) => Promise<CarModel | null>;
/** Opens the turntable with the car and its damage. */
export type ShowCar = (model: CarModel, damage: CarDamage) => Showroom;
/** Shows a backdrop in the stage's theme behind the menu; null goes back to the main menu's bend. */
export type Scenery = (stage: StageDef | null, weather?: Weather) => void;

const buyMessage = (
  result: BuyResult,
  price: number | undefined,
  done: string,
) =>
  result === "poor"
    ? `<div class="behind">Du har inte råd: det kostar ${formatMoney(price ?? 0)}.</div>`
    : typeof result === "object"
      ? done
      : "";

/** What to drive: car, stage, (for championships) the progress, and the weather and tyres. */
export interface Launch {
  model: CarModel;
  stage: StageDef;
  championship: ChampionshipProgress | null;
  weather: Weather;
  tyre: TyreType;
}

/** The next stage of a championship in progress, with the car and its upgrades, or null. */
export function resumeChampionship(): Omit<Launch, "weather" | "tyre"> | null {
  const p = loadChampionship();
  const def = p && championshipById(p.id);
  const stage = def && STAGES.find((s) => s.name === def.legs[p.leg]);
  const model =
    p && ownedModels(loadCareer().career).find((m) => nameOf(m) === p.car);
  return p && stage && model ? { model, stage, championship: p } : null;
}

/** Confirms retiring from the championship. The car is repaired for free, but there is no prize money. */
export async function confirmAbort(): Promise<boolean> {
  const c = await showMenu<"abort" | "stay">({
    title: "Avbryta mästerskapet?",
    body: "Du får inga prispengar för mästerskapet. Bilen lagas gratis och står hel i garaget.",
    items: [
      { label: "Fortsätt mästerskapet", value: "stay" },
      { label: "Avbryt och laga bilen gratis", value: "abort" },
    ],
    cancel: "stay",
  });
  if (c === "abort") saveChampionship(null);
  return c === "abort";
}

/**
 * The career main menu. Hands out the daily bonus the first time each day. Returns what to
 * drive, or null if the player backs out. With `gained` (e.g. prize money from a finished championship)
 * and the daily bonus, the cash counts up from the old amount, with a coin sound, the first time the menu is shown.
 */
export async function careerMenu(
  pick: Pick,
  showCar: ShowCar,
  scenery: Scenery,
  gained = 0,
): Promise<Launch | null> {
  let career = loadCareer().career;
  const bonus = claimDailyBonus(career, localDay());
  let message = "";
  if (bonus.bonus > 0) {
    career = bonus.career;
    commit(career);
    message = `Dagens besök: <span class="ahead">+${formatMoney(bonus.bonus)}</span>`;
  }
  let countFrom = career.money - gained - bonus.bonus;
  for (;;) {
    // Purchases have already counted down and jingled; here only income counts up.
    countFrom = Math.min(countFrom, career.money);
    const ongoing = loadChampionship();
    // A new career starts without a car: then there is only the dealer.
    const firstCar = Object.keys(career.garage).length === 0;
    const menu = showMenu<string>({
      title: "Karriär",
      subtitle: `Kassa: ${formatMoney(countFrom)}`,
      solid: true,
      body: `${trophyShelf(career)}${message ? `<div>${message}</div>` : ""}${
        firstCar
          ? "<div>Du har ingen bil än. Köp din första hos bilhandlaren; det som blir över räcker till delar.</div>"
          : `<div>Mästerskap: flera etapper i följd där skadorna följer med och lagas för pengar, men prispengarna är större. Enstaka lopp: prispengar efter tid, och bilen lagas gratis efteråt.</div>`
      }`,
      items: firstCar
        ? [
            { label: "Bilhandlare: köp din första bil", value: "dealer" },
            { label: "← Tillbaka", value: "back" },
          ]
        : [
            ongoing
              ? {
                  label: "Mästerskap",
                  detail: `pågår: ${championshipById(ongoing.id)?.name}, etapp ${ongoing.leg + 1} av ${championshipById(ongoing.id)?.legs.length}`,
                  value: "champ",
                }
              : {
                  label: "Mästerskap",
                  detail: `upp till ${formatMoney(Math.max(...CHAMPIONSHIPS.map((ch) => championshipMedals(ch, settings.difficulty)[0]!.prize)))}`,
                  value: "champ",
                },
            {
              label: "Enstaka lopp",
              detail: `upp till ${formatMoney(MEDALS[0].prize * Math.max(...Object.keys(career.garage).map((car) => TIER_PRIZE[tierOf(car)])))}`,
              value: "stage",
            },
            {
              label: "Historik",
              detail: career.history?.length
                ? `${career.history.length} händelser`
                : undefined,
              value: "history",
            },
            {
              label: "Garage",
              detail:
                Object.keys(career.garage).length === 1
                  ? "1 bil"
                  : `${Object.keys(career.garage).length} bilar`,
              value: "garage",
            },
            { label: "Bilhandlare", value: "dealer" },
            { label: "← Tillbaka", value: "back" },
          ],
      cancel: "back",
    });
    if (countFrom !== career.money) {
      coins();
      countUp(countFrom, career.money);
    }
    countFrom = career.money;
    const c = await menu;
    message = "";
    if (c === "back") return null;
    if (c === "stage") {
      const stage = await pickStage("Enstaka lopp", (s) => {
        const t = stageTargets(s.name);
        const t2 = tierUnlocked(career, 2) && stageTargets(s.name, 2);
        return t
          ? `guld under ${t[0]} s${t2 ? `, i klass 2 under ${t2[0]} s` : ""}`
          : "";
      });
      if (stage) {
        // Tyres after the car; Back from the tyres goes to the car picker.
        const weather = forcedWeather() ?? rollWeather(stage, Math.random());
        for (let model; (model = await pick(ownedModels(career))); ) {
          const tyre = await pickTyre(stage, weather);
          if (tyre) return { model, stage, championship: null, weather, tyre };
        }
      }
    }
    if (c === "champ") {
      const launch = ongoing
        ? await ongoingMenu(showCar)
        : await championshipMenu(career, pick, showCar, scenery);
      if (launch) return launch;
    }
    if (c === "history") await history(career);
    if (c === "garage") await garage(pick);
    if (c === "dealer") await dealer(pick);
    career = loadCareer().career;
  }
}

/** The championships: first the class, then the championship within it. */
async function championshipMenu(
  career: CareerState,
  pick: Pick,
  showCar: ShowCar,
  scenery: Scenery,
): Promise<Launch | null> {
  const tiers = [...new Set(CHAMPIONSHIPS.map((ch) => ch.tier))];
  for (;;) {
    const tier = await showMenu<Tier | 0>({
      title: "Mästerskap",
      solid: true,
      body: "<div>Flera etapper i följd med samma bil mot ett fält av andra förare. Skador följer med mellan etapperna; du kan göra service mellan etapperna och laga bilen om du behöver. Varje klass har egna mästerskap, och bara bilar i klassen får köra.</div>",
      items: [
        ...tiers.map((t) => {
          const list = CHAMPIONSHIPS.filter((ch) => ch.tier === t);
          const cars = CARS.map(nameOf)
            .filter((n) => tierOf(n) === t)
            .join(", ");
          return tierUnlocked(career, t)
            ? {
                label: `Klass ${t}`,
                note: cars,
                detail: `${list.filter((ch) => hasWon(career, ch)).length}/${list.length} vunna`,
                value: t,
              }
            : {
                label: `Klass ${t}`,
                note: cars,
                detail: `vinn ${CHAMPIONSHIPS.slice(
                  0,
                  CHAMPIONSHIPS.findIndex((ch) => ch.tier === t),
                )
                  .filter((ch) => !hasWon(career, ch))
                  .map((ch) => ch.name)
                  .join(" och ")}`,
                value: t,
                locked: true,
              };
        }),
        { label: "← Tillbaka", value: 0 },
      ],
      cancel: 0,
    });
    if (!tier) return null;
    if (!tierUnlocked(career, tier)) continue;
    const launch = await tierMenu(tier, career, pick, showCar, scenery);
    if (launch) return launch;
  }
}

/** The championships in a class. Null = back to the classes. */
async function tierMenu(
  tier: Tier,
  career: CareerState,
  pick: Pick,
  showCar: ShowCar,
  scenery: Scenery,
): Promise<Launch | null> {
  for (;;) {
    const id = await showMenu<string>({
      title: `Klass ${tier}`,
      solid: true,
      items: [
        ...CHAMPIONSHIPS.filter((ch) => ch.tier === tier).map((ch) =>
          championshipUnlocked(career, ch)
            ? { label: ch.name, note: championshipNote(career, ch), image: CHAMPIONSHIP_IMAGES[ch.id], value: ch.id }
            : { label: ch.name, note: championshipNote(career, ch), image: CHAMPIONSHIP_IMAGES[ch.id], value: ch.id, locked: true },
        ),
        { label: "← Tillbaka", value: "" },
      ],
      cancel: "",
    });
    const def = championshipById(id);
    if (!def) return null;
    if (!championshipUnlocked(career, def)) continue;
    const launch = await startChampionship(def, career, pick, showCar, scenery);
    if (launch) return launch;
  }
}

/** Facts beside the championship's image: stages, length, prize money and best position (or what unlocks it). */
function championshipNote(career: CareerState, def: ChampionshipDef) {
  const place = bestPlace(career, def);
  const km = championshipKm(def).toFixed(1).replace(".", ",");
  return [
    `${def.legs.length} etapper`,
    `Totalt: ${km} km`,
    championshipUnlocked(career, def) ? `Prispengar: ${formatMoney(championshipMedals(def, settings.difficulty)[0]!.prize)} ${trophy(1)}` : unlockHint(career, def),
    place && `<b>${trophy(place)}bäst ${place}:a</b>`,
  ]
    .filter(Boolean)
    .map((line) => `<span>${line}</span>`)
    .join("");
}

/** A history row as [what, details]. */
function describe(e: HistoryEntry): [string, string] {
  const money =
    e.amount > 0
      ? `<span class="ahead">+${formatMoney(e.amount)}</span>`
      : e.amount < 0
        ? `−${formatMoney(-e.amount)}`
        : "";
  const parts = (...xs: (string | false | undefined)[]) =>
    xs.filter(Boolean).join(" · ");
  if (e.kind === "stage")
    return [
      e.name,
      parts(
        e.time !== undefined && formatTime(e.time),
        e.medal ?? "i mål",
        e.car,
        money,
      ),
    ];
  if (e.kind === "championship")
    return [
      e.name,
      parts(
        !!e.place && `${trophy(e.place)}${e.place}:a av ${e.of}`,
        e.time !== undefined && formatTime(e.time),
        e.car,
        money,
      ),
    ];
  if (e.kind === "upgrade") return [e.name, parts(e.car, money)];
  return [`Köpte ${e.name}`, money];
}

/** One trophy per championship where the best position is on the podium, for the career overview. */
function trophyShelf(career: CareerState) {
  const won = CHAMPIONSHIPS.flatMap((ch) => {
    const place = bestPlace(career, ch);
    return place && place <= 3 ? [`<span title="${ch.name}: ${place}:a">${trophy(place)}</span>`] : [];
  });
  return won.length ? `<div class="trophies">${won.join("")}</div>` : "";
}

const dateOf = (at: number) =>
  new Date(at).toLocaleDateString("sv-SE", { day: "numeric", month: "short" });

/** Everything the player has done in the career, newest first. */
async function history(career: CareerState) {
  const list = [...(career.history ?? [])].reverse();
  const rows = list.map((e) => {
    const [what, detail] = describe(e);
    return `<tr><th>${dateOf(e.at)}</th><td><b>${what}</b><br>${detail}</td></tr>`;
  });
  await showMenu({
    title: "Historik",
    subtitle: `Kassa: ${formatMoney(career.money)}`,
    solid: true,
    body: rows.length
      ? `<table class="specs">${rows.join("")}</table>`
      : "<div>Inget än. Kör en etapp eller köp något så hamnar det här.</div>",
    items: [{ label: "← Tillbaka", value: 0 }],
    cancel: 0,
  });
}

/** Counts the cash in the menu subtitle up or down over 1.5 s, fast at first and slowing towards the end. */
function countUp(
  from: number,
  to: number,
  text = (money: string) => `Kassa: ${money}`,
) {
  const el = document.querySelector("#menu .subtitle");
  const start = performance.now();
  const tick = (now: number) => {
    if (!el?.isConnected) return;
    const t = Math.min(1, (now - start) / 1500);
    el.textContent = text(
      formatMoney(Math.round(from + (to - from) * (1 - (1 - t) ** 3))),
    );
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** The garage: the same turntable as the car picker, with the upgrades as a submenu. */
async function garage(pick: Pick) {
  await pick(ownedModels(loadCareer().career), {
    title: "Garage",
    subtitle: () => `Kassa: ${formatMoney(loadCareer().career.money)}`,
    action: { label: "Uppgradera", run: (m) => upgrades(nameOf(m)) },
  });
}

async function upgrades(car: string) {
  for (;;) {
    const career = loadCareer().career;
    const groups = [...new Set(upgradesFor(car).map((u) => u.group))];
    const group = await showMenu<string>({
      title: car,
      subtitle: `Kassa: ${formatMoney(career.money)}`,
      side: true,
      items: [
        ...groups.map((g) => {
          const parts = upgradesFor(car).filter((u) => u.group === g);
          return {
            label: g,
            detail: `${parts.filter((u) => levelOf(career, car, u.id)).length}/${parts.length} monterade`,
            value: g,
          };
        }),
        { label: "← Tillbaka", value: "" },
      ],
      cancel: "",
    });
    if (!group) return;
    await parts(car, group);
  }
}

async function parts(car: string, group: string) {
  const parts = upgradesFor(car).filter((u) => u.group === group);
  let message = "";
  let chosen: string | undefined;
  let countFrom = loadCareer().career.money;
  for (;;) {
    const career = loadCareer().career;
    const menu = showMenu<string>({
      title: group,
      initial: chosen,
      subtitle: `${car} · Kassa: ${formatMoney(countFrom)}`,
      side: true,
      body: message,
      items: [
        ...parts.map((u) => ({
          label: u.name,
          note: u.effect,
          detail: levelOf(career, car, u.id)
            ? "monterad"
            : formatMoney(u.price),
          value: u.id,
          denied: () => buyUpgrade(career, car, u.id) === "poor",
          confirm: levelOf(career, car, u.id)
            ? undefined
            : () => `Köpa för ${formatMoney(u.price)}?`,
        })),
        { label: "← Tillbaka", value: "" },
      ],
      cancel: "",
    });
    if (countFrom !== career.money)
      countUp(countFrom, career.money, (m) => `${car} · Kassa: ${m}`);
    countFrom = career.money;
    const id = await menu;
    if (!id) return;
    chosen = id;
    const u = parts.find((x) => x.id === id)!;
    const result = buyUpgrade(career, car, id);
    if (typeof result === "object") {
      commit(result);
      coins();
    }
    message = buyMessage(
      result,
      u.price,
      `<div class="ahead">${u.name} monterad.</div>`,
    );
  }
}

/** The dealer: the same turntable as the car picker, with owned cars to compare against. */
async function dealer(pick: Pick) {
  for (;;) {
    const career = loadCareer().career;
    const first = Object.keys(career.garage).length === 0;
    const forSale = CARS.filter((m) => !career.garage[nameOf(m)]);
    if (!forSale.length) {
      await showMenu({
        title: "Bilhandlare",
        solid: true,
        body: "Du äger redan alla bilar.",
        items: [{ label: "← Tillbaka", value: 0 }],
        cancel: 0,
      });
      return;
    }
    const bought = await pick(forSale, {
      title: "Bilhandlare",
      subtitle: () => `Kassa: ${formatMoney(loadCareer().career.money)}`,
      detail: (m) =>
        `klass ${tierOf(nameOf(m))} · ${formatMoney(CAR_PRICES[nameOf(m)] ?? 0)}`,
      compare: ownedModels(career),
      locked: (m) => !carUnlocked(career, nameOf(m)),
      lockedLabel: (m) => carUnlockHint(nameOf(m)),
      action: {
        label: "Köp",
        denied: (m) => buyCar(loadCareer().career, nameOf(m)) === "poor",
        confirm: (m) =>
          `Köpa ${nameOf(m)} för ${formatMoney(CAR_PRICES[nameOf(m)] ?? 0)}?`,
        run: async (m) => {
          const name = nameOf(m);
          const before = loadCareer().career.money;
          const result = buyCar(loadCareer().career, name);
          if (typeof result === "object") {
            commit(result);
            coins();
          }
          const menu = showMenu({
            title: typeof result === "object" ? "Köpt" : "Inget köp",
            subtitle: `Kassa: ${formatMoney(before)}`,
            side: true,
            body: buyMessage(
              result,
              CAR_PRICES[name],
              `<div class="ahead">${name} står nu i garaget.</div>`,
            ),
            items: [{ label: "OK", value: 0 }],
            cancel: 0,
          });
          if (typeof result === "object") countUp(before, result.money);
          await menu;
          return typeof result === "object";
        },
      },
    });
    // After a purchase the dealer is shown again without the bought car; after the first one, back to the career.
    if (!bought || first) return;
  }
}

/** Pays out prize money for a single run and returns a line for the finish screen. */
export function awardPrize(
  stageName: string,
  time: number,
  car: string,
): string {
  const { medal, prize } = prizeFor(stageName, time, tierOf(car));
  const career = loadCareer().career;
  commit(
    logged(
      { ...career, money: career.money + prize },
      { kind: "stage", name: stageName, car, time, medal, amount: prize },
    ),
  );
  return `<div class="prize">Prispengar: <span class="ahead">+${formatMoney(prize)}</span>${medal ? ` (${medal})` : ""}</div><div>Bilen lagas gratis efter enstaka lopp.</div>`;
}

/** Championship in progress: preview and service before the next stage, as between stages. */
async function ongoingMenu(showCar: ShowCar): Promise<Launch | null> {
  const launch = resumeChampionship();
  if (!launch) {
    saveChampionship(null);
    return null;
  }
  const p = launch.championship!;
  const left = await beforeLeg(
    championshipById(p.id)!,
    p.leg,
    p.damage ?? WHOLE,
    (d) => showCar(launch.model, d),
    legWeather(p),
    true,
  );
  if (!left) return null;
  const championship = { ...p, damage: repairCost(left.damage) === 0 ? null : left.damage };
  saveChampionship(championship);
  return left.later ? null : { ...launch, championship, weather: left.weather, tyre: left.tyre };
}

/** Browses the championship's stages with the same preview as before each stage, but without weather (it is rolled at start). */
async function browseLegs(def: ChampionshipDef, scenery: Scenery) {
  const n = def.legs.length;
  let leg = 0;
  // Arrows as in the car picker; no <button> since showMenu turns every button in the menu into a menu item.
  const bodyHtml = () => {
    const name = def.legs[leg]!;
    const stage = STAGES.find((s) => s.name === name);
    const title = `<b>${name}</b><small>${leg + 1}/${n}</small>`;
    return `<div class="car-nav">${n > 1 ? `<span data-leg="-1">‹</span>${title}<span data-leg="1">›</span>` : title}</div>${stage ? stagePreviewHtml(stage) : ""}${n > 1 ? '<div class="hint">← → byter etapp.</div>' : ""}`;
  };
  const step = (d: number) => {
    leg = (leg + d + n) % n;
    document.querySelector("#menu .body")!.innerHTML = bodyHtml();
    scenery(STAGES.find((s) => s.name === def.legs[leg]) ?? null);
  };
  const click = (e: MouseEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-leg]");
    if (el) step(Number(el.dataset.leg));
  };
  // Captured before the menu's own listener, which stops the key press.
  const key = (e: KeyboardEvent) => {
    const d =
      e.code === "ArrowLeft" || e.code === "KeyA"
        ? -1
        : e.code === "ArrowRight" || e.code === "KeyD"
          ? 1
          : 0;
    if (d && n > 1) step(d);
  };
  const menu = document.getElementById("menu")!;
  menu.addEventListener("click", click);
  addEventListener("keydown", key, true);
  scenery(STAGES.find((s) => s.name === def.legs[0]) ?? null);
  await showMenu({
    title: def.name,
    subtitle: "Etapper",
    side: true,
    body: bodyHtml(),
    items: [{ label: "← Tillbaka", value: 0 }],
    cancel: 0,
  });
  menu.removeEventListener("click", click);
  removeEventListener("keydown", key, true);
  scenery(null);
}

async function startChampionship(
  def: ChampionshipDef,
  career: CareerState,
  pick: Pick,
  showCar: ShowCar,
  scenery: Scenery,
): Promise<Launch | null> {
  let c: "go" | "legs" | "back";
  while (
    (c = await showMenu<"go" | "legs" | "back">({
      title: def.name,
      solid: true,
      body: `<img class="banner" src="${CHAMPIONSHIP_IMAGES[def.id]}" alt=""><div>Klass ${def.tier}. Etapper: ${def.legs.join(", ")}.</div><div>Du kör mot ${RIVAL_COUNT} andra förare, och totaltiden avgör placeringen. Omstart finns inte.</div><table class="specs">${championshipMedals(
        def,
        settings.difficulty,
      )
        .map(
          (m, i) =>
            `<tr><th>${trophy(i + 1)}${i + 1}:a</th><td>${formatMoney(m.prize)}</td></tr>`,
        )
        .join("")}</table>`,
      items: [
        { label: "Välj bil och starta", value: "go" },
        { label: "Se etapper", value: "legs" },
        { label: "← Tillbaka", value: "back" },
      ],
      cancel: "back",
    })) === "legs"
  )
    await browseLegs(def, scenery);
  if (c !== "go") return null;
  const model = await pick(ownedModels(career), {
    locked: (m) => tierOf(nameOf(m)) !== def.tier,
    lockedLabel: `Bara bilar i klass ${def.tier}`,
  });
  const stage = STAGES.find((s) => s.name === def.legs[0]);
  if (!model || !stage) return null;
  // The same preview and service as between stages, with an intact car.
  // The progress is created before the preview, so the first stage's weather can be shown; it is only saved at start.
  const progress = newProgress(
    def,
    nameOf(model),
    Math.floor(Math.random() * 2 ** 31),
    settings.difficulty,
  );
  const weather = legWeather(progress, 0);
  // The car picker leaves the main menu's bend behind it; the preview shows the stage's light and weather.
  scenery(stage, weather);
  const left = await beforeLeg(def, 0, WHOLE, (d) => showCar(model, d), weather);
  if (!left || left.later) {
    scenery(null);
    return null;
  }
  saveChampionship(progress);
  return { model, stage, championship: progress, weather: left.weather, tyre: left.tyre };
}

const WHOLE: CarDamage = {
  body: { front: 0, rear: 0, left: 0, right: 0, roof: 0 },
  wheels: [0, 0, 0, 0],
  powerFactor: 1,
  lamps: [0, 0],
};

const PART_NAMES: Record<RepairPart, string> = {
  body: "karossen",
  wheels: "hjulen",
  engine: "motorn",
  lamps: "strålkastarna",
};

const pct = (x: number) => `${Math.round(x * 100)} %`;

function damageHtml(d: CarDamage) {
  const b = d.body;
  const worstWheel = Math.max(...d.wheels);
  return `<table class="specs">
    <tr><th>Kaross</th><td>fram ${pct(b.front)} · bak ${pct(b.rear)} · vänster ${pct(b.left)} · höger ${pct(b.right)} · tak ${pct(b.roof)}</td></tr>
    <tr><th>Hjul</th><td>${worstWheel > 0 ? `värsta hjulet ${pct(worstWheel)} skadat` : "hela"}</td></tr>
    <tr><th>Motor</th><td>${pct(d.powerFactor)} effekt</td></tr>
    <tr><th>Strålkastare</th><td>${lampStatus(d.lamps ?? [0, 0])}</td></tr>
  </table>`;
}

/**
 * After a championship stage. Between stages: a preview of the next stage and then service where the player repairs with their own money,
 * drives on damaged or retires. After the last: total time and prize money. Returns the tyres when
 * the next stage is to be loaded, otherwise the prize money (0 if the player retires) on the way to the career. At service the car stands with its damage on
 * the turntable from showCar.
 */
const MEDAL_COLORS = [
  ["#fff6b0", "#f2c200", "#a87b00"],
  ["#ffffff", "#c9ced6", "#7d848f"],
  ["#ffd9b0", "#d4884a", "#8a4f1f"],
];

/** Shiny trophy in gold, silver or bronze for places 1–3, otherwise just the number. */
function trophy(place: number) {
  const c = MEDAL_COLORS[place - 1];
  if (!c) return `<span class="trophy">${place}.</span>`;
  const id = `trophy${place}`;
  return `<svg class="trophy" viewBox="0 0 24 24" role="img" aria-label="${place}:a"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c[0]}"/><stop offset=".45" stop-color="${c[1]}"/><stop offset="1" stop-color="${c[2]}"/></linearGradient></defs><path d="M6 5H3.5v1.5A3.5 3.5 0 0 0 7 10M18 5h2.5v1.5A3.5 3.5 0 0 1 17 10" fill="none" stroke="url(#${id})" stroke-width="1.6"/><path d="M6 3h12v4a6 6 0 0 1-4.5 5.8V16h2.5v2.5H8V16h2.5v-3.2A6 6 0 0 1 6 7zM6.5 19.5h11v2h-11z" fill="url(#${id})" stroke="${c[2]}" stroke-width=".6"/><path d="M8.3 4.5v2.5a4 4 0 0 0 1.6 3.2" fill="none" stroke="#fff" stroke-opacity=".8" stroke-linecap="round"/></svg>`;
}

/** Position on a stage as a round badge, in gold, silver and bronze for 1–3. */
const posBadge = (place: number) =>
  `<span class="pos p${place}">${place}</span>`;
/** The position of time `t` among `all` (which includes t). */
const rankOf = (t: number, all: number[]) =>
  1 + all.filter((x) => x < t).length;

/** The championship standings: position, name and total time, gap to the leader. */
function standingsHtml(table: Standing[]) {
  const lead = table[0]!.total;
  const rows = table
    .map((s, i) => {
      const name = s.player ? `<b>${s.name}</b>` : s.name;
      const gap =
        i === 0 ? formatTime(s.total) : `+${(s.total - lead).toFixed(2)}`;
      return `<tr${s.player ? ' class="ahead"' : ""}><th>${trophy(i + 1)}${name}</th><td>${gap}</td></tr>`;
    })
    .join("");
  return `<table class="specs standings"><tr><th></th><td>totalt</td></tr>${rows}</table>`;
}

/** The result of the latest stage: position, name, time and gap to the stage winner. */
function legResultHtml(table: Standing[]) {
  const byLeg = [...table].sort((a, b) => a.last - b.last);
  const best = byLeg[0]!.last;
  const rows = byLeg
    .map((s, i) => {
      const name = s.player ? `<b>${s.name}</b>` : s.name;
      return `<tr${s.player ? ' class="ahead"' : ""}><th>${posBadge(i + 1)}${name}</th><td>${formatTime(s.last)}</td><td>${i === 0 ? "" : `+${(s.last - best).toFixed(2)}`}</td></tr>`;
    })
    .join("");
  return `<table class="specs standings">${rows}</table>`;
}

export async function championshipLegDone(
  p: ChampionshipProgress,
  time: number,
  resultBody: string,
  damage: CarDamage,
  showCar: (d: CarDamage) => Showroom,
): Promise<{ tyre: TyreType } | { prize: number }> {
  const def = championshipById(p.id)!;
  const times = [...p.times, time];
  const total = times.reduce((a, b) => a + b, 0);
  p = raceRivals(p, time);
  const legRows = times
    .map(
      (t, i) =>
        `<tr><th>${def.legs[i]}</th><td>${formatTime(t)}${posBadge(rankOf(t, [t, ...p.rivals!.map((v) => v.times[i]!)]))}</td></tr>`,
    )
    .join("");
  const table = standings(p.rivals!, times);
  const place = table.findIndex((s) => s.player) + 1;

  if (times.length === def.legs.length) {
    const { prize } = championshipPrize(def, place, difficultyOf(p));
    const career = loadCareer().career;
    commit(
      logged(
        {
          ...(place === 1 ? withWin(career, def) : career),
          money: career.money + prize,
        },
        {
          kind: "championship",
          name: def.name,
          car: p.car,
          place,
          of: table.length,
          time: total,
          amount: prize,
        },
      ),
    );
    saveChampionship(null);
    await showMenu({
      title: def.legs[times.length - 1]!,
      subtitle: "Sista etappen",
      side: true,
      body: `${resultBody}${legResultHtml(table)}`,
      items: [{ label: "Se slutresultat", value: 0 }],
    });
    // A screen of its own: just the car and the final result, no other UI.
    document.body.classList.add("final-results");
    applause();
    if (place === 1) confetti();
    await showMenu({
      title: def.name,
      subtitle: "Slutresultat",
      side: true,
      body: `<div>${place === 1 ? '<b class="ahead">Du vann mästerskapet!</b>' : `Du kom <b>${place}:a</b> av ${table.length}.`}</div>${standingsHtml(table)}<table class="specs">${legRows}<tr><th>Totalt</th><td><b>${formatTime(total)}</b></td></tr></table><div class="prize">Prispengar: <span class="ahead">+${formatMoney(prize)}</span></div><div>Bilen lagas och står hel i garaget.</div>`,
      items: [{ label: "Avsluta mästerskapet", value: 0 }],
    });
    document.body.classList.remove("final-results");
    return { prize };
  }

  // Saved right away, so the stage counts even if the tab is closed before service.
  saveChampionship(afterLeg(p, time, damage, false));
  await showMenu({
    title: `Etapp ${times.length} av ${def.legs.length}`,
    side: true,
    subtitle: def.legs[times.length - 1],
    body: `${resultBody}${legResultHtml(table)}`,
    // The championship standings in a card of their own, so they are not mixed up with the stage result.
    aside: `<h1>Ställning</h1><div class="subtitle">${def.name}</div><div class="body"><div>Du ligger <b>${place}:a</b> av ${table.length} efter ${times.length} av ${def.legs.length} etapper.</div>${standingsHtml(table)}</div>`,
    items: [{ label: "Fortsätt", value: 0 }],
  });

  const left = await beforeLeg(
    def,
    times.length,
    damage,
    showCar,
    legWeather(p, times.length),
  );
  if (!left) return { prize: 0 };
  saveChampionship(afterLeg(p, time, left.damage, repairCost(left.damage) === 0));
  return left.later ? { prize: 0 } : { tyre: left.tyre };
}

/**
 * Before stage `leg` (0-based): a preview of the stage and service where the player repairs with their own money,
 * drives on damaged, saves for later (`pausable`) or retires. Returns the car's damage and whether
 * the player chose to continue later, or null if the championship was abandoned. Start goes via the tyre choice, whose
 * Back leads to the screen where start was chosen (the preview or service).
 */
async function beforeLeg(
  def: ChampionshipDef,
  leg: number,
  damage: CarDamage,
  showCar: (d: CarDamage) => Showroom,
  weather: Weather,
  pausable = leg > 0,
): Promise<
  | { damage: CarDamage; later: true }
  | { damage: CarDamage; later: false; weather: Weather; tyre: TyreType }
  | null
> {
  const nextName = def.legs[leg]!;
  const nextStage = STAGES.find((s) => s.name === nextName);
  weather = forcedWeather() ?? weather;
  // The turntable opens on the first visit to service and stays behind the preview.
  let room: Showroom | null = null;
  let message = "";
  let atService = false;
  // The row last chosen at service, so the highlight stays after a repair.
  let chosen: RepairPart | "all" | "go" | "back" | undefined;
  let countFrom = loadCareer().career.money;
  const start = async () => {
    const tyre = await pickTyre(nextStage!, weather);
    if (!tyre) return null;
    room?.close();
    return { damage, later: false as const, weather, tyre };
  };
  for (;;) {
    const cost = repairCost(damage);
    if (!atService) {
      const c = await showMenu<"service" | "go" | "later" | "abort">({
        title: leg === 0 ? nextName : `Nästa: ${nextName}`,
        subtitle: `Etapp ${leg + 1} av ${def.legs.length}`,
        side: true,
        body: `<div>Väder: ${WEATHER_NAMES[weather]}.</div>${nextStage ? stagePreviewHtml(nextStage) : ""}`,
        items: [
          // Before the first stage the car is new, so no service.
          ...(leg > 0
            ? [{ label: "Till service", value: "service" as const }]
            : []),
          {
            label: "Starta etappen",
            detail: cost > 0 ? "utan att laga" : undefined,
            value: "go",
          },
          ...(pausable
            ? [{ label: "Spara och fortsätt senare", value: "later" as const }]
            : []),
          { label: "Avbryt mästerskapet", value: "abort" },
        ],
        cancel: leg > 0 ? "service" : pausable ? "later" : "abort",
      });
      if (c === "go") {
        const s = await start();
        if (s) return s;
        continue;
      }
      if (c === "later") {
        room?.close();
        return { damage, later: true };
      }
      if (c === "abort") {
        if (await confirmAbort()) {
          room?.close();
          return null;
        }
        continue;
      }
      atService = true;
      room ??= showCar(damage);
      continue;
    }
    const money = loadCareer().career.money;
    const parts = partCosts(damage);
    const broken = (Object.keys(parts) as RepairPart[]).filter(
      (k) => parts[k] > 0,
    );
    const menu = showMenu<RepairPart | "all" | "go" | "back">({
      title: "Service",
      initial: chosen,
      subtitle: `Kassa: ${formatMoney(countFrom)} · nästa: ${nextName}`,
      side: true,
      body: `${message}${cost > 0 ? `${damageHtml(damage)}<div>Att laga allt kostar ${formatMoney(cost)}.</div>` : "<div>Bilen är hel.</div>"}`,
      items: [
        ...(broken.length > 1
          ? [
              {
                label: "Laga allt",
                detail: formatMoney(cost),
                value: "all" as const,
                denied: () => money < cost,
                confirm: () => `Laga allt för ${formatMoney(cost)}?`,
              },
            ]
          : []),
        ...broken.map((k) => ({
          label: `Laga ${PART_NAMES[k]}`,
          detail: formatMoney(parts[k]),
          value: k,
          denied: () => money < parts[k],
          confirm: () => `Laga ${PART_NAMES[k]} för ${formatMoney(parts[k])}?`,
        })),
        {
          label: cost > 0 ? "Kör vidare utan att laga" : "Kör nästa etapp",
          value: "go",
        },
        { label: "← Tillbaka", value: "back" },
      ],
      cancel: "back",
    });
    if (countFrom !== money)
      countUp(countFrom, money, (m) => `Kassa: ${m} · nästa: ${nextName}`);
    countFrom = money;
    const c = await menu;
    chosen = c === "back" ? undefined : c;
    if (c === "back") {
      atService = false;
      message = "";
      continue;
    }
    if (c !== "go") {
      const fix = c === "all" ? broken : [c];
      const price = c === "all" ? cost : parts[c];
      if (money < price) {
        message = `<div class="behind">Du har inte råd: det kostar ${formatMoney(price)}.</div>`;
        continue;
      }
      commit({ ...loadCareer().career, money: money - price });
      coins();
      damage = fix.reduce(repairPart, damage);
      room?.repair(fix.includes("body"), fix.includes("wheels"));
      message = `<div class="ahead">${c === "all" ? "Lagad" : `Lagade ${PART_NAMES[c]}`} för ${formatMoney(price)}.</div>`;
      continue;
    }
    const s = await start();
    if (s) return s;
  }
}
