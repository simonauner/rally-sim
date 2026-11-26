import type { Section } from '../physics/ghost';
import type { Stage } from '../physics/stage';

const NEUTRAL: [number, number, number] = [158, 158, 158];
const GAIN: [number, number, number] = [46, 125, 50];
const LOSS: [number, number, number] = [198, 40, 40];

const mix = (a: number[], b: number[], t: number) => `rgb(${a.map((v, i) => Math.round(v + (b[i]! - v) * t)).join(',')})`;

/**
 * Etappen ovanifrån som SVG, roterad så att den går från vänster till höger.
 * Med sektioner färgas vägen grön där åket tjänade tid och röd där det tappade.
 */
export function stageMapHtml(stage: Stage, startS: number, finishS: number, sections: Section[] | null): string {
  // Ovanifrån med +Z uppåt hamnar bilens vänster (+X) åt vänster, alltså skärm-x = -x.
  const a = stage.poseAt(startS);
  const b = stage.poseAt(finishS);
  const ang = Math.atan2(-(b.z - a.z), -(b.x - a.x));
  const cos = Math.cos(-ang);
  const sin = Math.sin(-ang);
  const pt = (s: number): [number, number] => {
    const i = Math.round(Math.max(0, Math.min(stage.length, s)));
    const x = -stage.xs[i]!;
    const y = -stage.zs[i]!;
    return [x * cos - y * sin, x * sin + y * cos];
  };
  const path = (from: number, to: number) => {
    const pts: string[] = [];
    for (let s = from; s < to; s += 5) pts.push(pt(s).map((v) => v.toFixed(1)).join(','));
    pts.push(pt(to).map((v) => v.toFixed(1)).join(','));
    return pts.join(' ');
  };

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let s = 0; s <= stage.length; s += 5) {
    const [x, y] = pt(s);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const pad = 30;
  const w = maxX - minX + 2 * pad;
  const h = maxY - minY + 2 * pad;
  // Linjebredder i kartans enheter (meter), så att de blir lika tjocka oavsett etappens storlek.
  const k = Math.max(w, h) / 400;

  const scale = Math.max(0.15, ...(sections ?? []).map((x) => Math.abs(x.loss)));
  const colored = (sections ?? [])
    .map((x) => {
      // Roten gör att även små förluster syns, utan att de största slår i taket.
      const t = Math.sqrt(Math.min(1, Math.abs(x.loss) / scale));
      return `<polyline points="${path(x.from, x.to)}" stroke="${mix(NEUTRAL, x.loss > 0 ? LOSS : GAIN, t)}" stroke-width="${5 * k}" />`;
    })
    .join('');
  const [sx, sy] = pt(startS);
  const [fx, fy] = pt(finishS);

  let summary = 'Inget tidigare åk att jämföra med.';
  if (sections && sections.length) {
    const total = sections.reduce((sum, x) => sum + x.loss, 0);
    const worst = sections.reduce((m, x) => (x.loss > m.loss ? x : m));
    const bestGain = sections.reduce((m, x) => (x.loss < m.loss ? x : m));
    const at = (x: Section) => `${x.from - startS}–${x.to - startS} m`;
    summary = [
      `Mot förra rekordet: <span class="${total <= 0 ? 'ahead' : 'behind'}">${total <= 0 ? '−' : '+'}${Math.abs(total).toFixed(2)} s</span>`,
      worst.loss > 0 ? `mest tappat <span class="behind">+${worst.loss.toFixed(2)}</span> vid ${at(worst)}` : '',
      bestGain.loss < 0 ? `mest tjänat <span class="ahead">−${(-bestGain.loss).toFixed(2)}</span> vid ${at(bestGain)}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
  }

  return `<svg class="stage-map" viewBox="${(minX - pad).toFixed(0)} ${(minY - pad).toFixed(0)} ${w.toFixed(0)} ${h.toFixed(0)}" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="${path(0, stage.length)}" stroke="#0000001f" stroke-width="${9 * k}" />
    <polyline points="${path(startS, finishS)}" stroke="rgb(${NEUTRAL.join(',')})" stroke-width="${5 * k}" />
    ${colored}
    <circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="${7 * k}" fill="#2e7d32" stroke="#fff" stroke-width="${2 * k}" />
    <circle cx="${fx.toFixed(1)}" cy="${fy.toFixed(1)}" r="${7 * k}" fill="#c62828" stroke="#fff" stroke-width="${2 * k}" />
  </svg>
  <div class="map-legend">${summary}<br/><small><span style="color:#2e7d32">●</span> start <span style="color:#c62828">●</span> mål · grönt = tjänat tid, rött = tappat, per 25 m</small></div>`;
}
