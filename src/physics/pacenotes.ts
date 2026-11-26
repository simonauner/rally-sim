import type { Stage } from './stage';
import type { SurfaceId } from './surfaces';

export type NoteKind = 'corner' | 'crest' | 'surface' | 'finish';

export interface PaceNote {
  kind: NoteKind;
  /** Där noten börjar och slutar längs etappen (m). */
  s: number;
  end: number;
  /** Uppläst text, t.ex. "vänster fyra lång, hundra". */
  speech: string;
  /** Kort text för skärmen, t.ex. "V4 lång · 100". */
  label: string;
  /** 1 = vänster, -1 = höger (bara kurvor). */
  dir?: number;
  /** 1 = snävast, 6 = snabbast (bara kurvor). */
  grade?: number;
}

/** Halva fönstret (m) för att mäta kurvighet. */
const WINDOW = 6;
/** Kurvor flackare än så här (radie i m) är raksträcka. */
const STRAIGHT_R = 200;
/** Radiegränser för grad 1..6. */
const GRADE_R = [20, 35, 55, 80, 120, STRAIGHT_R];
const MIN_TURN = 0.3;
const MERGE_GAP = 12;
const LONG = 70;
const CREST_SPAN = 15;
const CREST_DROP = 0.5;
/** Så nära (m) ett underlagsbyte en korsande väg måste ansluta för att det ska vara en korsning. */
const JUNCTION_GAP = 15;

const GRADE_WORDS = ['', 'ett', 'två', 'tre', 'fyra', 'fem', 'sex'];
const SURFACE_WORDS: Record<SurfaceId, string> = { gravel: 'grus', asphalt: 'asfalt', mud: 'lera', snow: 'snö' };
const DISTANCE_WORDS: Record<number, string> = {
  50: 'femtio',
  100: 'hundra',
  150: 'hundrafemtio',
  200: 'tvåhundra',
  250: 'tvåhundrafemtio',
  300: 'trehundra',
};

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Räknar fram noter ur etappens geometri: kurvor, krön, underlagsbyten, korsningar och mål. */
export function generateNotes(stage: Stage, startS: number, finishS: number): PaceNote[] {
  // Etappen samplas en gång per meter, så sampelindex är samma sak som sträcka.
  const n = stage.xs.length;
  const heading = (i: number) => {
    const a = Math.max(0, Math.min(n - 2, i));
    return Math.atan2(stage.xs[a + 1]! - stage.xs[a]!, stage.zs[a + 1]! - stage.zs[a]!);
  };
  // Krökning per meter; positiv = vänster (heading ökar mot +X).
  const k = new Float64Array(n);
  for (let i = 0; i < n; i++) k[i] = wrap(heading(i + WINDOW) - heading(i - WINDOW)) / (2 * WINDOW);

  const notes: PaceNote[] = [];

  // Kurvor: sammanhängande bitar med samma riktning och radie under STRAIGHT_R.
  const groups: { a: number; b: number; dir: number }[] = [];
  for (let i = 0; i < n; i++) {
    if (Math.abs(k[i]!) < 1 / STRAIGHT_R) continue;
    const dir = Math.sign(k[i]!);
    const last = groups[groups.length - 1];
    if (last && last.dir === dir && i - last.b <= MERGE_GAP) last.b = i;
    else groups.push({ a: i, b: i, dir });
  }
  for (const { a, b, dir } of groups) {
    if (a < startS || a > finishS) continue;
    const turn = Math.abs(wrap(heading(b) - heading(a)));
    if (turn < MIN_TURN) continue;
    let maxK = 0;
    for (let i = a; i <= b; i++) maxK = Math.max(maxK, Math.abs(k[i]!));
    const r = 1 / maxK;
    const grade = GRADE_R.findIndex((g) => r < g) + 1 || 6;
    const long = b - a > LONG;
    notes.push({
      kind: 'corner',
      s: a,
      end: b,
      dir,
      grade,
      speech: `${dir > 0 ? 'vänster' : 'höger'} ${GRADE_WORDS[grade]}${long ? ' lång' : ''}`,
      label: `${dir > 0 ? 'V' : 'H'}${grade}${long ? ' lång' : ''}`,
    });
  }

  // Krön: vägen är tydligt konvex i höjdled.
  let lastCrest = -Infinity;
  for (let i = CREST_SPAN; i < n - CREST_SPAN; i++) {
    const drop = stage.ys[i - CREST_SPAN]! + stage.ys[i + CREST_SPAN]! - 2 * stage.ys[i]!;
    if (drop < -CREST_DROP && i - lastCrest > 40 && i > startS && i < finishS) {
      notes.push({ kind: 'crest', s: i - 5, end: i + 5, speech: 'krön', label: 'krön' });
      lastCrest = i;
    }
  }

  // Underlagsbyten; där en korsande väg ansluter leds etappen in på en ny väg i en korsning.
  const junctions = stage.spurs.map((sp) => stage.project(sp.points[0]!.x, sp.points[0]!.z).s);
  for (let i = 1; i < n; i++) {
    if (stage.surfaces[i] === stage.surfaces[i - 1] || i < startS || i > finishS) continue;
    const word = SURFACE_WORDS[stage.surfaces[i]!];
    const atJunction = junctions.some((js) => Math.abs(js - i) < JUNCTION_GAP);
    notes.push({
      kind: 'surface',
      s: i,
      end: i,
      speech: atJunction ? `korsning, ${word}` : word,
      label: atJunction ? `korsning ${word}` : word,
    });
  }

  notes.push({ kind: 'finish', s: finishS, end: finishS, speech: 'mål', label: 'mål' });
  notes.sort((x, y) => x.s - y.s);

  // Avstånd från där allt hittills slutar till nästa not, avrundat nedåt till 50 m.
  let end = -Infinity;
  for (let i = 0; i < notes.length - 1; i++) {
    end = Math.max(end, notes[i]!.end);
    const gap = Math.min(300, Math.floor((notes[i + 1]!.s - end) / 50) * 50);
    if (gap < 50) continue;
    notes[i]!.speech += `, ${DISTANCE_WORDS[gap]}`;
    notes[i]!.label += ` · ${gap}`;
  }
  return notes;
}

/** Håller reda på vilka noter kartläsaren har läst upp. */
export class NoteCaller {
  private next = 0;

  constructor(readonly notes: PaceNote[]) {}

  /** Nästa not blir den första efter s, t.ex. efter omstart eller teleport. */
  seek(s: number) {
    this.next = this.notes.findIndex((n) => n.s > s);
    if (this.next < 0) this.next = this.notes.length;
  }

  /** Noter som ska läsas upp nu: ungefär tre sekunder före, minst 40 och högst 150 m. */
  update(s: number, speed: number): PaceNote[] {
    const lead = Math.min(150, Math.max(40, speed * 3));
    const out: PaceNote[] = [];
    while (this.next < this.notes.length && this.notes[this.next]!.s - lead <= s) out.push(this.notes[this.next++]!);
    return out;
  }

  /** Upplästa noter som bilen inte har passerat än. */
  active(s: number): PaceNote[] {
    return this.notes.slice(0, this.next).filter((n) => n.end > s);
  }
}
