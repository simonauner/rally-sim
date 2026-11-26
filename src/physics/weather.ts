/** Väder per etapp: slumpas vid start, oftast uppehåll. Ren data och logik. */

import type { StageDef } from './stage';
import type { SurfaceId } from './surfaces';

export type Weather = 'clear' | 'rain' | 'fog' | 'snowfall';

export const WEATHER_NAMES: Record<Weather, string> = { clear: 'uppehåll', rain: 'regn', fog: 'dimma', snowfall: 'snöfall' };

/** Greppet multipliceras med detta per underlag; saknas underlaget ändras inget. */
export const WEATHER_GRIP: Record<Weather, Partial<Record<SurfaceId, number>>> = {
  clear: {},
  // Blöt asfalt tappar mest, grus och lera blir kladdigare.
  rain: { asphalt: 0.75, gravel: 0.88, mud: 0.85 },
  fog: {},
  // Nysnö ovanpå den packade snön.
  snowfall: { snow: 0.9, gravel: 0.92 },
};

/** Hur mycket långsammare en förare kör i vädret, för motståndarnas tider. */
export const WEATHER_SLOWDOWN: Record<Weather, number> = { clear: 1, rain: 1.05, fog: 1.03, snowfall: 1.04 };

/** Vädret för ett slumptal r i [0, 1): ungefär tre av fyra etapper har uppehåll. */
export function rollWeather(def: StageDef, r: number): Weather {
  if (def.winter) return r < 0.14 ? 'snowfall' : r < 0.24 ? 'fog' : 'clear';
  return r < 0.13 ? 'rain' : r < 0.23 ? 'fog' : 'clear';
}
