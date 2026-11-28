/** Weather per stage: rolled at the start, usually dry. Pure data and logic. */

import type { StageDef } from './stage';
import type { SurfaceId } from './surfaces';

export type Weather = 'clear' | 'rain' | 'fog' | 'snowfall';

export const WEATHER_NAMES: Record<Weather, string> = { clear: 'uppehåll', rain: 'regn', fog: 'dimma', snowfall: 'snöfall' };

/** Grip is multiplied by this per surface; a missing surface is unchanged. */
export const WEATHER_GRIP: Record<Weather, Partial<Record<SurfaceId, number>>> = {
  clear: {},
  // Wet asphalt loses the most; gravel and mud get stickier.
  rain: { asphalt: 0.75, gravel: 0.88, mud: 0.85 },
  fog: {},
  // Fresh snow on top of the packed snow.
  snowfall: { snow: 0.9, gravel: 0.92 },
};

/** How much slower a driver goes in this weather, for the opponents' times. */
export const WEATHER_SLOWDOWN: Record<Weather, number> = { clear: 1, rain: 1.05, fog: 1.03, snowfall: 1.04 };

/** Weather for a random number r in [0, 1): about three in four stages are dry. */
export function rollWeather(def: StageDef, r: number): Weather {
  if (def.winter) return r < 0.14 ? 'snowfall' : r < 0.24 ? 'fog' : 'clear';
  return r < 0.13 ? 'rain' : r < 0.23 ? 'fog' : 'clear';
}
