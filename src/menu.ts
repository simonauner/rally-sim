import applauseUrl from './assets/applause.mp3';
import coinsUrl from './assets/coins.mp3';
import { settings } from './settings';

export interface MenuItem<T> {
  label: string;
  /** Small text on the right, e.g. best time. */
  detail?: string;
  /** Small line below the text, e.g. what a part does. */
  note?: string;
  /** Image (URL) on the left of the button, e.g. a view from the championship's stages. */
  image?: string;
  value: T;
  /** True if the choice isn't allowed, e.g. too little money: then it goes duh-duh instead of a click. Read on click. */
  denied?: () => boolean;
  /**
   * Locked: grey text with a padlock. Without denied the row shakes its head with duh-duh and the menu stays with
   * the highlight on the row; with denied that applies, and the value is returned as usual.
   */
  locked?: boolean;
  /** The question when the row flips for confirmation, e.g. on purchase. Read on click; Ja gives the value, Nej flips back. */
  confirm?: () => string;
}

/** Lucide's lock (lucide-static 1.81.0, ISC). */
export const LOCK_ICON =
  '<svg class="lock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';

export interface MenuOptions<T> {
  title: string;
  subtitle?: string;
  /** Free text below the heading (HTML), e.g. the controls list. */
  body?: string;
  items: MenuItem<T>[];
  /** The value Esc gives; without it Esc does nothing. */
  cancel?: T;
  /** Cover the game fully (main menu) instead of showing it dimmed behind (pause). */
  solid?: boolean;
  /** The panel at the right edge without dimming the game, e.g. the finish screen where the car is visible. */
  side?: boolean;
  /** One more panel, to the right of the usual one (HTML), e.g. the car you compare with. */
  aside?: string;
  /** The choices in the aside panel instead of the usual one, e.g. when they belong to it. */
  itemsInAside?: boolean;
  /** Small text in the bottom right corner of the screen, e.g. version. */
  footer?: string;
  /** A text field below the text; onDone gets what was typed when the menu closes. */
  input?: { placeholder: string; onDone: (value: string) => void };
  /** The choice highlighted when the menu opens; otherwise the first. */
  initial?: T;
  /** Called when the highlight moves, also for the first choice. */
  onSelect?: (value: T) => void;
}

const root = () => document.getElementById('menu')!;

let blipCtx: AudioContext | null = null;
let clickNoise: AudioBuffer | null = null;
const menuAudio = () => {
  if (!settings.sound || !settings.menuSound) return null;
  // Created on the first click, which is a user gesture, so the browser allows the sound.
  return (blipCtx ??= new AudioContext());
};

/** Light click: a short noise burst, brighter for selection. */
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

/** Falling tone, for when a choice isn't allowed. */
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
  // The browser may refuse to play; then it's silent instead of an error.
  a.play().catch(() => {});
}

/** Applause and cheering when a championship is finished. */
export const applause = () => playClip(applauseUrl, 0.6);

/** Coins dropping into a purse when you pay for something. */
export const coins = () => playClip(coinsUrl, 0.6);

/**
 * Shows a menu and waits for a choice. Controlled with arrow keys/W/S and Enter, or the mouse.
 * The menu captures key presses so the game doesn't see them; key releases pass through,
 * otherwise a key held down when the menu opened could get stuck in the game.
 */
export function showMenu<T>(opts: MenuOptions<T>): Promise<T> {
  const el = root();
  el.className = opts.solid ? 'solid' : opts.side ? 'side' : opts.aside ? 'pair' : '';
  const items = `<div class="items">${opts.items
    .map((it, i) => {
      const cls = [it.image && 'pic', it.locked && 'locked'].filter(Boolean).join(' ');
      return `<button data-i="${i}"${cls ? ` class="${cls}"` : ''}${it.image ? ` style="--img: url('${it.image}')"` : ''}>${it.image ? '<i class="thumb"></i>' : ''}<span>${it.label}${it.locked ? LOCK_ICON : ''}${it.note ? `<span class="note">${it.note}</span>` : ''}</span>${it.detail ? `<small>${it.detail}</small>` : ''}</button>`;
    })
    .join('')}</div>`;
  const panels = `
    <div class="panel">
      <h1>${opts.title}</h1>
      ${opts.subtitle ? `<div class="subtitle">${opts.subtitle}</div>` : ''}
      ${opts.body ? `<div class="body">${opts.body}</div>` : ''}
      ${opts.input ? `<input type="text" autocomplete="off" spellcheck="false" placeholder="${opts.input.placeholder}" />` : ''}
      ${opts.itemsInAside ? '' : items}
    </div>
    ${opts.aside ? `<div class="panel aside">${opts.aside}${opts.itemsInAside ? items : ''}</div>` : ''}`;
  // To the side, the panels sit in a row that can slide up (see #menu.side in index.html).
  el.innerHTML = `${opts.side && !opts.solid ? `<div class="panels">${panels}</div>` : panels}
    ${opts.footer ? `<div class="corner">${opts.footer}</div>` : ''}`;
  el.style.display = 'flex';
  const buttons = [...el.querySelectorAll('button')];
  let sel = 0;
  // The flipped row (index) and whether Ja is highlighted; alongside it sits the row's usual content.
  let flipped: { i: number; yes: boolean; html: string } | null = null;
  const unflip = () => {
    if (!flipped) return;
    const b = buttons[flipped.i]!;
    b.innerHTML = flipped.html;
    b.classList.remove('flipped');
    // Flipped back with the same motion; restarting the animation needs a reflow in between.
    b.classList.remove('unflip');
    void b.offsetWidth;
    b.classList.add('unflip');
    flipped = null;
  };
  const choose = (yes: boolean) => {
    if (!flipped) return;
    if (yes !== flipped.yes) click(3000);
    flipped.yes = yes;
    buttons[flipped.i]!.querySelectorAll('.choices b').forEach((c, j) => c.classList.toggle('on', (j === 0) === yes));
  };
  const flip = (i: number, question: string) => {
    unflip();
    click(4500);
    const b = buttons[i]!;
    flipped = { i, yes: true, html: b.innerHTML };
    b.innerHTML = `<span>${question}</span><span class="choices"><b data-c="yes">Ja</b><b data-c="no">Nej</b></span>`;
    // Same animation as unflip: without a reflow in between it doesn't restart.
    b.classList.remove('unflip');
    void b.offsetWidth;
    b.classList.add('flipped');
    choose(true);
  };
  const select = (i: number) => {
    if ((i + buttons.length) % buttons.length !== sel) {
      click(3000);
      unflip();
    }
    sel = (i + buttons.length) % buttons.length;
    buttons.forEach((b, j) => b.classList.toggle('selected', j === sel));
    buttons[sel]?.scrollIntoView({ block: 'nearest' });
    opts.onSelect?.(opts.items[sel]!.value);
  };
  select(Math.max(0, opts.items.findIndex((it) => it.value === opts.initial)));
  const input = el.querySelector('input');
  input?.focus();

  return new Promise<T>((resolve) => {
    let closing = false;
    const done = (value: T, item?: MenuItem<T>) => {
      if (closing) return;
      const denied = item?.denied ? item.denied() : item?.locked;
      if (item?.locked && !item.denied) {
        const i = opts.items.indexOf(item);
        select(i);
        blip(220, 0.14);
        blip(165, 0.22, 0.17);
        // Restart the shake even if it is already running.
        const b = buttons[i]!;
        b.classList.remove('shake');
        void b.offsetWidth;
        b.classList.add('shake');
        return;
      }
      // The first choice of a row that needs confirming flips it instead of choosing.
      if (item?.confirm && !denied && flipped?.i !== opts.items.indexOf(item)) {
        flip(opts.items.indexOf(item), item.confirm());
        return;
      }
      if (flipped && item && flipped.i === opts.items.indexOf(item) && !flipped.yes) {
        click(2600);
        click(1400, 0.06);
        unflip();
        return;
      }
      // Duh-duh: two low, falling tones when the choice isn't allowed.
      if (denied) {
        blip(220, 0.14);
        blip(165, 0.22, 0.17);
      } else if (value === opts.cancel) {
        // Tillbaka: two falling clicks, so it differs from a normal choice.
        click(2600);
        click(1400, 0.06);
      } else click(4500);
      opts.input?.onDone(input?.value ?? '');
      removeEventListener('keydown', onKey, true);
      const close = () => {
        el.style.display = 'none';
        el.innerHTML = '';
        resolve(value);
      };
      // After Ja the row is seen flipping back before the menu closes.
      if (flipped) {
        closing = true;
        unflip();
        setTimeout(close, 220);
      } else close();
    };
    const onKey = (e: KeyboardEvent) => {
      e.stopImmediatePropagation();
      // In the text field keys are typed as usual; only Enter and Esc control the menu.
      if (e.target === input && e.code !== 'Enter' && e.code !== 'Escape') return;
      e.preventDefault();
      if (e.repeat && (e.code === 'Enter' || e.code === 'Space' || e.code === 'Escape')) return;
      if (flipped && (e.code === 'ArrowLeft' || e.code === 'KeyA')) choose(true);
      else if (flipped && (e.code === 'ArrowRight' || e.code === 'KeyD')) choose(false);
      else if (flipped && e.code === 'Escape') {
        click(2600);
        click(1400, 0.06);
        unflip();
      } else if (e.code === 'ArrowUp' || e.code === 'KeyW') select(sel - 1);
      else if (e.code === 'ArrowDown' || e.code === 'KeyS') select(sel + 1);
      else if (e.code === 'Enter' || e.code === 'Space') done(opts.items[sel]!.value, opts.items[sel]);
      else if (e.code === 'Escape' && opts.cancel !== undefined) done(opts.cancel);
    };
    // Capture on window: runs before the game's own listeners.
    addEventListener('keydown', onKey, true);
    buttons.forEach((b, i) => {
      b.addEventListener('mouseenter', () => select(i));
      b.addEventListener('click', (e) => {
        const c = (e.target as HTMLElement).closest<HTMLElement>('.choices b');
        if (c && flipped?.i === i) choose(c.dataset.c === 'yes');
        done(opts.items[i]!.value, opts.items[i]);
      });
      b.addEventListener('mousemove', (e) => {
        const c = (e.target as HTMLElement).closest<HTMLElement>('.choices b');
        if (c && flipped?.i === i) choose(c.dataset.c === 'yes');
      });
    });
  });
}

/**
 * Loading screen covering the game, with `body` (e.g. the stage card) under the spinner, so it shows above the map. `status` changes the line
 * by the spinner and waits until it is visible; `hide` removes the screen.
 */
export function showLoading(title: string, body = '', subtitle = ''): { status: (text: string) => Promise<void>; hide: () => void } {
  const el = root();
  el.className = 'solid';
  el.innerHTML = `<div class="panel"><h1>${title}</h1>${subtitle ? `<div class="subtitle">${subtitle}</div>` : ''}<div class="loading"><span class="spinner"></span><span>Laddar…</span></div>${body ? `<div class="body">${body}</div>` : ''}</div>`;
  el.style.display = 'flex';
  const text = el.querySelector('.loading > span:last-child')!;
  return {
    async status(t) {
      text.textContent = t;
      // Wait until the screen has actually been drawn, otherwise the text doesn't show until the heavy work is done.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    },
    hide() {
      el.style.display = 'none';
      el.innerHTML = '';
    },
  };
}
