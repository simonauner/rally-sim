import type { Stage } from './stage';
import type { SurfaceId } from './surfaces';

/** Swedish, or English when the browser has no Swedish voice. */
export type Lang = 'sv' | 'en';

export type NoteKind = 'corner' | 'crest' | 'surface' | 'finish';

export interface PaceNote {
  kind: NoteKind;
  /** Where the note starts and ends along the stage (m). */
  s: number;
  end: number;
  /** Spoken text per language, e.g. "vänster fyra lång, hundra". */
  speech: Record<Lang, string>;
  /** Short text for the screen, e.g. "V4 lång · 100". */
  label: string;
  /** 1 = left, -1 = right (corners only). */
  dir?: number;
  /** 1 = tightest, 6 = fastest (corners only). */
  grade?: number;
}

/** Half the window (m) for measuring curvature. */
const WINDOW = 6;
/** Corners gentler than this (radius in m) count as straight. */
const STRAIGHT_R = 200;
/** Radius limits for grades 1..6. */
const GRADE_R = [20, 35, 55, 80, 120, STRAIGHT_R];
const MIN_TURN = 0.3;
const MERGE_GAP = 12;
const LONG = 70;
const CREST_SPAN = 15;
const CREST_DROP = 0.5;
/** How close (m) to a surface change a crossing road must join for it to count as a junction. */
const JUNCTION_GAP = 15;

const WORDS = {
  sv: {
    left: 'vänster',
    right: 'höger',
    grades: ['', 'ett', 'två', 'tre', 'fyra', 'fem', 'sex'],
    long: 'lång',
    crest: 'krön',
    junction: 'korsning',
    finish: 'mål',
    surfaces: { gravel: 'grus', asphalt: 'asfalt', mud: 'lera', snow: 'snö', water: 'vatten' } as Record<SurfaceId, string>,
    distances: { 50: 'femtio', 100: 'hundra', 150: 'hundrafemtio', 200: 'tvåhundra', 250: 'tvåhundrafemtio', 300: 'trehundra' } as Record<number, string>,
  },
  en: {
    left: 'left',
    right: 'right',
    grades: ['', 'one', 'two', 'three', 'four', 'five', 'six'],
    long: 'long',
    crest: 'crest',
    junction: 'junction',
    finish: 'finish',
    surfaces: { gravel: 'gravel', asphalt: 'tarmac', mud: 'mud', snow: 'snow', water: 'water' } as Record<SurfaceId, string>,
    distances: { 50: 'fifty', 100: 'one hundred', 150: 'one fifty', 200: 'two hundred', 250: 'two fifty', 300: 'three hundred' } as Record<number, string>,
  },
};
/** The same note in both languages. */
const speak = (f: (w: (typeof WORDS)['sv']) => string): Record<Lang, string> => ({ sv: f(WORDS.sv), en: f(WORDS.en) });

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Derives notes from the stage geometry: corners, crests, surface changes, junctions and the finish. */
export function generateNotes(stage: Stage, startS: number, finishS: number): PaceNote[] {
  // The stage is sampled once per metre, so the sample index equals the distance.
  const n = stage.xs.length;
  const heading = (i: number) => {
    const a = Math.max(0, Math.min(n - 2, i));
    return Math.atan2(stage.xs[a + 1]! - stage.xs[a]!, stage.zs[a + 1]! - stage.zs[a]!);
  };
  // Curvature per metre; positive = left (heading increases towards +X).
  const k = new Float64Array(n);
  for (let i = 0; i < n; i++) k[i] = wrap(heading(i + WINDOW) - heading(i - WINDOW)) / (2 * WINDOW);

  const notes: PaceNote[] = [];

  // Corners: contiguous stretches with the same direction and a radius below STRAIGHT_R.
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
      speech: speak((w) => `${dir > 0 ? w.left : w.right} ${w.grades[grade]}${long ? ` ${w.long}` : ''}`),
      label: `${dir > 0 ? 'V' : 'H'}${grade}${long ? ' lång' : ''}`,
    });
  }

  // Crests: the road is clearly convex vertically.
  let lastCrest = -Infinity;
  for (let i = CREST_SPAN; i < n - CREST_SPAN; i++) {
    const drop = stage.ys[i - CREST_SPAN]! + stage.ys[i + CREST_SPAN]! - 2 * stage.ys[i]!;
    if (drop < -CREST_DROP && i - lastCrest > 40 && i > startS && i < finishS) {
      notes.push({ kind: 'crest', s: i - 5, end: i + 5, speech: speak((w) => w.crest), label: 'krön' });
      lastCrest = i;
    }
  }

  // Surface changes; where a crossing road joins, the stage turns onto a new road at a junction.
  const junctions = stage.spurs.map((sp) => stage.project(sp.points[0]!.x, sp.points[0]!.z).s);
  for (let i = 1; i < n; i++) {
    if (stage.surfaces[i] === stage.surfaces[i - 1] || i < startS || i > finishS) continue;
    const surface = stage.surfaces[i]!;
    const word = WORDS.sv.surfaces[surface];
    const atJunction = junctions.some((js) => Math.abs(js - i) < JUNCTION_GAP);
    notes.push({
      kind: 'surface',
      s: i,
      end: i,
      speech: speak((w) => (atJunction ? `${w.junction}, ${w.surfaces[surface]}` : w.surfaces[surface])),
      label: atJunction ? `korsning ${word}` : word,
    });
  }

  notes.push({ kind: 'finish', s: finishS, end: finishS, speech: speak((w) => w.finish), label: 'mål' });
  notes.sort((x, y) => x.s - y.s);

  // Distance from where everything so far ends to the next note, rounded down to 50 m.
  let end = -Infinity;
  for (let i = 0; i < notes.length - 1; i++) {
    end = Math.max(end, notes[i]!.end);
    const gap = Math.min(300, Math.floor((notes[i + 1]!.s - end) / 50) * 50);
    if (gap < 50) continue;
    for (const lang of ['sv', 'en'] as const) notes[i]!.speech[lang] += `, ${WORDS[lang].distances[gap]}`;
    notes[i]!.label += ` · ${gap}`;
  }
  return notes;
}

/** Keeps track of which notes the co-driver has called. */
export class NoteCaller {
  private next = 0;

  constructor(readonly notes: PaceNote[]) {}

  /** The next note becomes the first one after s, e.g. after a restart or teleport. */
  seek(s: number) {
    this.next = this.notes.findIndex((n) => n.s > s);
    if (this.next < 0) this.next = this.notes.length;
  }

  /**
   * Notes to call now: about three seconds ahead (40–150 m), but five seconds ahead
   * (60–250 m) for tight corners (grade 1–2) that need long braking. Notes before a tight corner
   * are called together with it, so the order is kept.
   */
  update(s: number, speed: number): PaceNote[] {
    const lead = (n: PaceNote) => (n.grade !== undefined && n.grade <= 2 ? Math.min(250, Math.max(60, speed * 5)) : Math.min(150, Math.max(40, speed * 3)));
    let last = this.next;
    for (let j = this.next; j < this.notes.length && this.notes[j]!.s - 250 <= s; j++) if (this.notes[j]!.s - lead(this.notes[j]!) <= s) last = j + 1;
    const out = this.notes.slice(this.next, last);
    this.next = last;
    return out;
  }

  /** Called notes the car has not passed yet. */
  active(s: number): PaceNote[] {
    return this.notes.slice(0, this.next).filter((n) => n.end > s);
  }
}
