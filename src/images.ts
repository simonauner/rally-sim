import skogsrallytImg from './assets/champ-skogsrallyt.webp';
import myrkullarallytImg from './assets/champ-myrkullarallyt.webp';
import vinterrallytImg from './assets/champ-vinterrallyt.webp';
import forsrallytImg from './assets/champ-forsrallyt.webp';
import tallmoklassikernImg from './assets/champ-tallmoklassikern.webp';
import ljunghedsrallytImg from './assets/champ-ljunghedsrallyt.webp';
import israllytImg from './assets/champ-israllyt.webp';

/**
 * Mästerskapens bilder, samma i karriären och i fri körning: vyn från motorhuven vid starten av en
 * etapp i varje mästerskap, tagen i spelet i uppehållsväder.
 */
export const CHAMPIONSHIP_IMAGES: Record<string, string> = {
  skogsrallyt: skogsrallytImg,
  myrkullarallyt: myrkullarallytImg,
  vinterrallyt: vinterrallytImg,
  forsrallyt: forsrallytImg,
  tallmoklassikern: tallmoklassikernImg,
  ljunghedsrallyt: ljunghedsrallytImg,
  israllyt: israllytImg,
};

const stageFiles = import.meta.glob<string>('./assets/stage-*.webp', { eager: true, import: 'default' });

/**
 * Etappens bild: motorhuvsvyn i uppehållsväder strax före det som utmärker den (gård, sjö,
 * kraftledning, krön …), i src/assets/stage-<namn utan å, ä, ö>.webp.
 */
export function stageImage(name: string): string | undefined {
  const slug = name.toLowerCase().replace(/[åä]/g, 'a').replace(/ö/g, 'o').replace(/ /g, '-');
  return stageFiles[`./assets/stage-${slug}.webp`];
}
