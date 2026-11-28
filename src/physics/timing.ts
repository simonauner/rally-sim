export type TimerState = 'ready' | 'running' | 'finished';

/** Longest jump in distance per step that counts as driving; larger jumps are teleports. */
const MAX_STEP_S = 5;

/**
 * Timing along a stage. Receives the car's distance (s) every physics step and counts in physics time,
 * so the result does not depend on the frame rate.
 */
export class StageTimer {
  state: TimerState = 'ready';
  time = 0;
  /** Times at the split points, in order. */
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
