export interface MenuItem<T> {
  label: string;
  /** Liten text till höger, t.ex. bästa tid. */
  detail?: string;
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
}

const root = () => document.getElementById('menu')!;

/**
 * Visar en meny och väntar på ett val. Styrs med piltangenter/W/S och Enter, eller musen.
 * Menyn fångar tangenttryck så att spelet inte ser dem; släppta tangenter går igenom,
 * annars kan en tangent som hölls in när menyn öppnades fastna i spelet.
 */
export function showMenu<T>(opts: MenuOptions<T>): Promise<T> {
  const el = root();
  el.className = opts.solid ? 'solid' : '';
  el.innerHTML = `
    <div class="panel">
      <h1>${opts.title}</h1>
      ${opts.subtitle ? `<div class="subtitle">${opts.subtitle}</div>` : ''}
      ${opts.body ? `<div class="body">${opts.body}</div>` : ''}
      <div class="items">${opts.items
        .map((it, i) => `<button data-i="${i}"><span>${it.label}</span>${it.detail ? `<small>${it.detail}</small>` : ''}</button>`)
        .join('')}</div>
    </div>`;
  el.style.display = 'flex';
  const buttons = [...el.querySelectorAll('button')];
  let sel = 0;
  const select = (i: number) => {
    sel = (i + buttons.length) % buttons.length;
    buttons.forEach((b, j) => b.classList.toggle('selected', j === sel));
  };
  select(0);

  return new Promise<T>((resolve) => {
    const done = (value: T) => {
      removeEventListener('keydown', onKey, true);
      el.style.display = 'none';
      el.innerHTML = '';
      resolve(value);
    };
    const onKey = (e: KeyboardEvent) => {
      e.stopImmediatePropagation();
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
