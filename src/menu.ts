import applauseUrl from './assets/applause.mp3';
import coinsUrl from './assets/coins.mp3';
import { settings } from './settings';

export interface MenuItem<T> {
  label: string;
  /** Liten text till höger, t.ex. bästa tid. */
  detail?: string;
  /** Liten rad under texten, t.ex. vad en del gör. */
  note?: string;
  /** Bild (URL) till vänster i knappen, t.ex. en vy från mästerskapets etapper. */
  image?: string;
  value: T;
  /** Sant om valet inte går, t.ex. för lite pengar: då låter det duh-duh i stället för klick. Läses vid klicket. */
  denied?: () => boolean;
  /** Låst: grå text med hänglås, och duh-duh vid klick om inte denied säger annat. Värdet returneras ändå. */
  locked?: boolean;
}

/** Lucides lock (lucide-static 1.81.0, ISC). */
export const LOCK_ICON =
  '<svg class="lock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';

export interface MenuOptions<T> {
  title: string;
  subtitle?: string;
  /** Fritext under rubriken (HTML), t.ex. kontrollistan. */
  body?: string;
  items: MenuItem<T>[];
  /** Värdet som Esc ger; utan det gör Esc ingenting. */
  cancel?: T;
  /** Täck spelet helt (huvudmeny) i stället för att visa det dämpat bakom (paus). */
  solid?: boolean;
  /** Panelen vid högerkanten utan att dämpa spelet, t.ex. målskärmen där bilen syns. */
  side?: boolean;
  /** En panel till, till höger om den vanliga (HTML), t.ex. bilen man jämför med. */
  aside?: string;
  /** Liten text nere i högra hörnet av skärmen, t.ex. version. */
  footer?: string;
  /** Ett textfält under texten; onDone får det inskrivna när menyn stängs. */
  input?: { placeholder: string; onDone: (value: string) => void };
  /** Valet som är markerat när menyn öppnas; annars det första. */
  initial?: T;
  /** Anropas när markeringen flyttas, även för första valet. */
  onSelect?: (value: T) => void;
}

const root = () => document.getElementById('menu')!;

let blipCtx: AudioContext | null = null;
let clickNoise: AudioBuffer | null = null;
const menuAudio = () => {
  if (!settings.sound || !settings.menuSound) return null;
  // Skapas vid första klicket, som är en användargest, så webbläsaren tillåter ljudet.
  return (blipCtx ??= new AudioContext());
};

/** Lätt klick: en kort brusstöt, ljusare för val. */
function click(freq: number, delay = 0) {
  const ctx = menuAudio();
  if (!ctx) return;
  if (!clickNoise) {
    clickNoise = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.02), ctx.sampleRate);
    const d = clickNoise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = clickNoise;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = 1.5;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.25, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.015);
  src.connect(bp).connect(g).connect(ctx.destination);
  src.start(t);
}

/** Ton som faller, för när ett val inte går. */
function blip(freq: number, length: number, delay = 0) {
  const ctx = menuAudio();
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(freq, t);
  osc.frequency.exponentialRampToValueAtTime(freq * 0.7, t + length);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.08, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + length);
  osc.connect(g).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + length);
}

function playClip(url: string, volume: number) {
  if (!settings.sound || !settings.menuSound) return;
  const a = new Audio(url);
  a.volume = volume;
  // Webbläsaren kan vägra spela; då blir det tyst i stället för ett fel.
  a.play().catch(() => {});
}

/** Applåder och jubel när ett mästerskap är klart. */
export const applause = () => playClip(applauseUrl, 0.6);

/** Mynt som faller ner i en börs när man betalar för något. */
export const coins = () => playClip(coinsUrl, 0.6);

/**
 * Visar en meny och väntar på ett val. Styrs med piltangenter/W/S och Enter, eller musen.
 * Menyn fångar tangenttryck så att spelet inte ser dem; släppta tangenter går igenom,
 * annars kan en tangent som hölls in när menyn öppnades fastna i spelet.
 */
export function showMenu<T>(opts: MenuOptions<T>): Promise<T> {
  const el = root();
  el.className = opts.solid ? 'solid' : opts.side ? 'side' : opts.aside ? 'pair' : '';
  el.innerHTML = `
    <div class="panel">
      <h1>${opts.title}</h1>
      ${opts.subtitle ? `<div class="subtitle">${opts.subtitle}</div>` : ''}
      ${opts.body ? `<div class="body">${opts.body}</div>` : ''}
      ${opts.input ? `<input type="text" autocomplete="off" spellcheck="false" placeholder="${opts.input.placeholder}" />` : ''}
      <div class="items">${opts.items
        .map((it, i) => {
          const cls = [it.image && 'pic', it.locked && 'locked'].filter(Boolean).join(' ');
          return `<button data-i="${i}"${cls ? ` class="${cls}"` : ''}${it.image ? ` style="--img: url('${it.image}')"` : ''}>${it.image ? '<i class="thumb"></i>' : ''}<span>${it.locked ? LOCK_ICON : ''}${it.label}${it.note ? `<span class="note">${it.note}</span>` : ''}</span>${it.detail ? `<small>${it.detail}</small>` : ''}</button>`;
        })
        .join('')}</div>
    </div>
    ${opts.aside ? `<div class="panel aside">${opts.aside}</div>` : ''}
    ${opts.footer ? `<div class="corner">${opts.footer}</div>` : ''}`;
  el.style.display = 'flex';
  const buttons = [...el.querySelectorAll('button')];
  let sel = 0;
  const select = (i: number) => {
    if ((i + buttons.length) % buttons.length !== sel) click(3000);
    sel = (i + buttons.length) % buttons.length;
    buttons.forEach((b, j) => b.classList.toggle('selected', j === sel));
    buttons[sel]?.scrollIntoView({ block: 'nearest' });
    opts.onSelect?.(opts.items[sel]!.value);
  };
  select(Math.max(0, opts.items.findIndex((it) => it.value === opts.initial)));
  const input = el.querySelector('input');
  input?.focus();

  return new Promise<T>((resolve) => {
    const done = (value: T, item?: MenuItem<T>) => {
      // Duh-duh: två låga, fallande toner när valet inte går.
      if (item?.denied ? item.denied() : item?.locked) {
        blip(220, 0.14);
        blip(165, 0.22, 0.17);
      } else if (value === opts.cancel) {
        // Tillbaka: två klick som faller, så det skiljer sig från ett vanligt val.
        click(2600);
        click(1400, 0.06);
      } else click(4500);
      opts.input?.onDone(input?.value ?? '');
      removeEventListener('keydown', onKey, true);
      el.style.display = 'none';
      el.innerHTML = '';
      resolve(value);
    };
    const onKey = (e: KeyboardEvent) => {
      e.stopImmediatePropagation();
      // I textfältet skrivs tangenterna som vanligt; bara Enter och Esc styr menyn.
      if (e.target === input && e.code !== 'Enter' && e.code !== 'Escape') return;
      e.preventDefault();
      if (e.repeat && (e.code === 'Enter' || e.code === 'Space' || e.code === 'Escape')) return;
      if (e.code === 'ArrowUp' || e.code === 'KeyW') select(sel - 1);
      else if (e.code === 'ArrowDown' || e.code === 'KeyS') select(sel + 1);
      else if (e.code === 'Enter' || e.code === 'Space') done(opts.items[sel]!.value, opts.items[sel]);
      else if (e.code === 'Escape' && opts.cancel !== undefined) done(opts.cancel);
    };
    // Capture på window: körs före spelets egna lyssnare.
    addEventListener('keydown', onKey, true);
    buttons.forEach((b, i) => {
      b.addEventListener('mouseenter', () => select(i));
      b.addEventListener('click', () => done(opts.items[i]!.value, opts.items[i]));
    });
  });
}

/** Laddningsskärm som täcker spelet. Returnerar en funktion som tar bort den. */
export async function showLoading(title: string): Promise<() => void> {
  const el = root();
  el.className = 'solid';
  el.innerHTML = `<div class="panel"><h1>${title}</h1><div class="loading"><span class="spinner"></span>Laddar…</div></div>`;
  el.style.display = 'flex';
  // Vänta tills skärmen faktiskt har ritats, annars syns den inte förrän det tunga jobbet är klart.
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  return () => {
    el.style.display = 'none';
    el.innerHTML = '';
  };
}
