/** Confetti raining over the screen for a few seconds, e.g. when you've won a championship. */

const COLORS = ['#f2c200', '#e4572e', '#29a3d6', '#4caf50', '#e94f9c', '#ffffff'];

export function confetti(seconds = 6) {
  const canvas = document.createElement('canvas');
  // Above the menu (z-index 2000), but clicks pass through.
  canvas.style.cssText = 'position:fixed;inset:0;z-index:2002;pointer-events:none';
  document.body.append(canvas);
  const ctx = canvas.getContext('2d')!;
  const dpr = devicePixelRatio || 1;
  const w = (canvas.width = innerWidth * dpr);
  const h = (canvas.height = innerHeight * dpr);
  const pieces = Array.from({ length: 220 }, () => ({
    x: Math.random() * w,
    y: -Math.random() * h * 0.8,
    vx: (Math.random() - 0.5) * 80 * dpr,
    vy: (80 + Math.random() * 120) * dpr,
    a: Math.random() * Math.PI * 2,
    va: (Math.random() - 0.5) * 12,
    size: (6 + Math.random() * 6) * dpr,
    color: COLORS[Math.floor(Math.random() * COLORS.length)]!,
  }));
  let last = performance.now();
  let left = seconds;
  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    left -= dt;
    ctx.clearRect(0, 0, w, h);
    // Fade out during the last second.
    ctx.globalAlpha = Math.max(0, Math.min(1, left));
    for (const p of pieces) {
      p.x += (p.vx + Math.sin(now / 300 + p.a) * 40 * dpr) * dt;
      p.y += p.vy * dt;
      p.a += p.va * dt;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.a);
      // The pieces spin around their long axis: the width pulses.
      ctx.scale(Math.cos(p.a * 1.7), 1);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    }
    if (left > 0) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}
