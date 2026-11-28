import type { Input } from './physics/car';

/** Keyboard and gamepad. Ramps make keys softer than on/off. */
export class Controls {
  private keys = new Set<string>();
  private pressed = new Set<string>();
  private throttle = 0;
  private brake = 0;
  private steer = 0;

  constructor() {
    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F1', 'F3'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }

  /** True once per key press. */
  wasPressed(code: string): boolean {
    return this.pressed.delete(code);
  }

  endFrame() {
    this.pressed.clear();
  }

  private down(...codes: string[]) {
    return codes.some((c) => this.keys.has(c));
  }

  sample(dt: number): Input {
    const pad = navigator.getGamepads?.().find((g) => g && g.connected) ?? null;

    let throttleT = this.down('KeyW', 'ArrowUp') ? 1 : 0;
    let brakeT = this.down('KeyS', 'ArrowDown') ? 1 : 0;
    let steerT = (this.down('KeyA', 'ArrowLeft') ? 1 : 0) - (this.down('KeyD', 'ArrowRight') ? 1 : 0);
    let handbrake = this.down('Space') ? 1 : 0;

    if (pad) {
      const dead = (v: number) => (Math.abs(v) < 0.08 ? 0 : v);
      const rt = pad.buttons[7]?.value ?? 0;
      const lt = pad.buttons[6]?.value ?? 0;
      if (rt > 0.02) throttleT = rt;
      if (lt > 0.02) brakeT = lt;
      const ax = dead(pad.axes[0] ?? 0);
      if (ax !== 0) steerT = -ax;
      if (pad.buttons[0]?.pressed) handbrake = 1;
    }

    const ramp = (cur: number, target: number, up: number, down: number) =>
      cur + Math.max(-down * dt, Math.min(up * dt, target - cur));
    this.throttle = ramp(this.throttle, throttleT, 4, 9);
    this.brake = ramp(this.brake, brakeT, 6, 12);
    this.steer = ramp(this.steer, steerT, 5, 7);

    return { throttle: this.throttle, brake: this.brake, steer: this.steer, handbrake };
  }
}
