import { settings } from './settings';

export interface MenuItem<T> {
  label: string;
  /** Liten text till höger, t.ex. bästa tid. */
  detail?: string;
  /** Liten rad under texten, t.ex. vad en del gör. */
  note?: string;
  value: T;
  /** Sant om valet inte går, t.ex. för lite pengar: då låter det duh-duh i stället för klick. Läses vid klicket. */
  denied?: () => boolean;
}

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
  /** Anropas när markeringen flyttas, även för första valet. */
  onSelect?: (value: T) => void;
}

const root = () => document.getElementById('menu')!;

let blipCtx: AudioContext | null = null;
/** Kort klick: hög ton för val, mellanton för att flytta, låg för att backa. */
function blip(freq: number, length: number, delay = 0) {
  if (!settings.sound || !settings.menuSound) return;
  // Skapas vid första klicket, som är en användargest, så webbläsaren tillåter ljudet.
  const ctx = (blipCtx ??= new AudioContext());
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

/** Lågmälda applåder när ett mästerskap är klart, med jubel på pallen. Syntetiserat ur brus. */
export function applause(cheer: boolean) {
  if (!settings.sound || !settings.menuSound) return;
  const ctx = (blipCtx ??= new AudioContext());
  const t = ctx.currentTime;
  const len = 3.5;
  const rate = ctx.sampleRate;
  const play = (data: (d: Float32Array) => void, filter: BiquadFilterNode, gain: GainNode) => {
    const buf = ctx.createBuffer(1, Math.floor(rate * len), rate);
    data(buf.getChannelData(0));
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start(t);
  };
  // Applåder: hundratals korta brusknäppar, tätast i början och glesare mot slutet.
  const clapFilter = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 1800, Q: 0.7 });
  play((d) => {
    const n = Math.floor(rate * 0.012);
    for (let k = 0; k < 600; k++) {
      const at = Math.random() ** 1.6 * (len - 0.05);
      const start = Math.floor(at * rate);
      const amp = (0.3 + Math.random() * 0.7) * (1 - at / len);
      for (let i = 0; i < n; i++) d[start + i]! += (Math.random() * 2 - 1) * amp * Math.exp(-i / (n / 5));
    }
  }, clapFilter, new GainNode(ctx, { gain: 0.1 }));
  if (!cheer) return;
  // Jubel: brus genom ett smalt band som vandrar runt en vokal, som ett avlägset "jaaa".
  const voice = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 850, Q: 3 });
  voice.frequency.setValueAtTime(700, t);
  voice.frequency.linearRampToValueAtTime(1000, t + 0.4);
  voice.frequency.linearRampToValueAtTime(750, t + len);
  const g = new GainNode(ctx, { gain: 0 });
  g.gain.linearRampToValueAtTime(0.09, t + 0.3);
  g.gain.exponentialRampToValueAtTime(0.001, t + len);
  play((d) => {
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }, voice, g);
}

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
        .map((it, i) => `<button data-i="${i}"><span>${it.label}${it.note ? `<span class="note">${it.note}</span>` : ''}</span>${it.detail ? `<small>${it.detail}</small>` : ''}</button>`)
        .join('')}</div>
    </div>
    ${opts.aside ? `<div class="panel aside">${opts.aside}</div>` : ''}
    ${opts.footer ? `<div class="corner">${opts.footer}</div>` : ''}`;
  el.style.display = 'flex';
  const buttons = [...el.querySelectorAll('button')];
  let sel = 0;
  const select = (i: number) => {
    if ((i + buttons.length) % buttons.length !== sel) blip(660, 0.04);
    sel = (i + buttons.length) % buttons.length;
    buttons.forEach((b, j) => b.classList.toggle('selected', j === sel));
    buttons[sel]?.scrollIntoView({ block: 'nearest' });
    opts.onSelect?.(opts.items[sel]!.value);
  };
  select(0);
  const input = el.querySelector('input');
  input?.focus();

  return new Promise<T>((resolve) => {
    const done = (value: T, item?: MenuItem<T>) => {
      // Duh-duh: två låga, fallande toner när valet inte går.
      if (item?.denied?.()) {
        blip(220, 0.14);
        blip(165, 0.22, 0.17);
      } else blip(value === opts.cancel ? 330 : 880, 0.09);
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
