import skogsrallytImg from './assets/champ-skogsrallyt.webp';
import myrkullarallytImg from './assets/champ-myrkullarallyt.webp';
import vinterrallytImg from './assets/champ-vinterrallyt.webp';
import forsrallytImg from './assets/champ-forsrallyt.webp';
import tallmoklassikernImg from './assets/champ-tallmoklassikern.webp';
import ljunghedsrallytImg from './assets/champ-ljunghedsrallyt.webp';
import israllytImg from './assets/champ-israllyt.webp';

/**
 * The championships' images, the same in career and free driving: the view from the bonnet at the start of a
 * stage in each championship, captured in game in dry weather.
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
 * The stage's image: the bonnet view in dry weather just before what makes it distinctive (farm, lake,
 * power line, crest …), in src/assets/stage-<name without å, ä, ö>.webp.
 */
export function stageImage(name: string): string | undefined {
  const slug = name.toLowerCase().replace(/[åä]/g, 'a').replace(/ö/g, 'o').replace(/ /g, '-');
  return stageFiles[`./assets/stage-${slug}.webp`];
}
