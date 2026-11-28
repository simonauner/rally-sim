import GUI from 'lil-gui';
import type { Car } from './physics/car';
import type { TyreType } from './physics/surfaces';

export interface GuiActions {
  teleport: (name: string) => void;
  repair: () => void;
  toggleDebug: (on: boolean) => void;
}

/** Tuning panel: everything can be changed while driving. */
export function createGui(car: Car, places: [label: string, key: string][], actions: GuiActions) {
  const gui = new GUI({ title: 'Trimning', width: 290 });
  const p = car.params;

  const tyre = gui.addFolder('Däck');
  tyre.add(p, 'tyre', { Grusdäck: 'gravel', Asfaltsdäck: 'tarmac', Vinterdäck: 'snow' } satisfies Record<string, TyreType>).name('Typ');
  tyre.add(p, 'gripScale', 0.4, 1.6, 0.01).name('Gripmultiplikator');

  const susp = gui.addFolder('Fjädring');
  susp.add(p.susp, 'kFront', 12000, 60000, 500).name('Fjäder fram (N/m)');
  susp.add(p.susp, 'kRear', 12000, 60000, 500).name('Fjäder bak (N/m)');
  susp.add(p.susp, 'bump', 500, 6000, 50).name('Dämpning ihop');
  susp.add(p.susp, 'rebound', 500, 8000, 50).name('Dämpning isär');
  susp.add(p.susp, 'arbFront', 0, 40000, 500).name('Krängn.hämmare fram');
  susp.add(p.susp, 'arbRear', 0, 40000, 500).name('Krängn.hämmare bak');

  const brakes = gui.addFolder('Bromsar');
  brakes.add(p.brake, 'total', 1500, 9000, 50).name('Bromsmoment');
  brakes.add(p.brake, 'bias', 0.35, 0.85, 0.01).name('Balans fram');

  const drive = gui.addFolder('Drivlina');
  drive.add(p, 'frontShare', 0, 1, 0.05).name('Moment till fram (0 = RWD)');
  drive.add(p.diff, 'lock', 0, 1, 0.01).name('Differentialspärr');
  drive.add(p.diff, 'preload', 0, 300, 5).name('Förspänning (Nm)');

  const assists = gui.addFolder('Hjälpmedel');
  assists.add(car.assists, 'abs').name('ABS');
  assists.add(car.assists, 'tc').name('Antispinn');
  assists.add(car.assists, 'steerAssist', 0, 1, 0.05).name('Motstyrning');

  const test = gui.addFolder('Testplatser');
  for (const [label, key] of places) test.add({ go: () => actions.teleport(key) }, 'go').name(label);
  test.add({ repair: actions.repair }, 'repair').name('Reparera bilen');

  const view = gui.addFolder('Visa');
  view.add({ on: true }, 'on').name('Kraftvektorer (F3)').onChange(actions.toggleDebug);

  gui.close();
  gui.open();
  tyre.open();
  return gui;
}
