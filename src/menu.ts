import { settings } from './settings';

export interface MenuItem<T> {
  label: string;
  /** Liten text till höger, t.ex. bästa tid. */
  detail?: string;
  /** Liten rad under texten, t.ex. vad en del gör. */
  note?: string;
  value: T;
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
function blip(freq: number, length: number) {
  if (!settings.sound || !settings.menuSound) return;
  // Skapas vid första klicket, som är en användargest, så webbläsaren tillåter ljudet.
  const ctx = (blipCtx ??= new AudioContext());
  const t = ctx.currentTime;
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
    const done = (value: T) => {
      blip(value === opts.cancel ? 330 : 880, 0.09);
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
      else if (e.code === 'Enter' || e.code === 'Space') done(opts.items[sel]!.value);
      else if (e.code === 'Escape' && opts.cancel !== undefined) done(opts.cancel);
    };
    // Capture på window: körs före spelets egna lyssnare.
    addEventListener('keydown', onKey, true);
    buttons.forEach((b, i) => {
      b.addEventListener('mouseenter', () => select(i));
      b.addEventListener('click', () => done(opts.items[i]!.value));
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
