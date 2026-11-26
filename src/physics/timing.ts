export type TimerState = 'ready' | 'running' | 'finished';

/** Längsta hopp i sträcka per steg som räknas som körning; större hopp är teleport. */
const MAX_STEP_S = 5;

/**
 * Tidtagning längs en etapp. Får bilens sträcka (s) varje fysiksteg och räknar i fysiktid,
 * så resultatet beror inte på bildfrekvensen.
 */
export class StageTimer {
  state: TimerState = 'ready';
  time = 0;
  /** Tider vid mellantiderna, i ordning. */
  splits: number[] = [];
  readonly splitAt: number[];
  private lastS = NaN;

  constructor(
    readonly startS: number,
    readonly finishS: number,
    splitCount = 2,
  ) {
    this.splitAt = Array.from({ length: splitCount }, (_, i) => startS + ((finishS - startS) * (i + 1)) / (splitCount + 1));
  }

  reset() {
    this.state = 'ready';
    this.time = 0;
    this.splits = [];
    this.lastS = NaN;
  }

  update(s: number, dt: number) {
    const prev = this.lastS;
    this.lastS = s;
    const crossed = (line: number) => prev < line && s >= line && s - prev < MAX_STEP_S;
    if (this.state === 'ready') {
      if (crossed(this.startS)) this.state = 'running';
      return;
    }
    if (this.state !== 'running') return;
    this.time += dt;
    const next = this.splitAt[this.splits.length];
    if (next !== undefined && crossed(next)) this.splits.push(this.time);
    if (crossed(this.finishS)) this.state = 'finished';
  }
}
