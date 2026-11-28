/**
 * Body shape, one per car in this folder. Each car has its own file, so changing one car's
 * shape never affects another. New details in the shared code in carMesh.ts are switched on with a field here,
 * so cars that don't set the field look as before.
 */

export type Range = readonly [number, number];

/** Body shape in car coordinates (forward = +z, origin at the centre of mass). */
export interface BodyShape {
  halfX: number;
  bottom: number;
  /** Front and rear edge of the bodywork. */
  nose: number;
  tail: number;
  /** The belt line, straight from hood to boot lid. */
  belt: number;
  roof: number;
  /** Height of the side moulding. */
  crease: number;
  /** Base and top (z) of the windscreen and rear window. */
  screen: Range;
  backlight: Range;
  /** How much the hood slopes down towards the front and the boot lid towards the rear edge. */
  hoodDrop: number;
  trunkDrop: number;
  cabinHalfX: number;
  /** Wheel arch centre (y) and radius, front and rear. */
  archY: number;
  archR: Range;
  /** Door seams behind the windscreen base (z). */
  doorSeams: number[];
  /** Side windows (z from, to). ±Infinity follows the A- and C-pillar respectively. */
  sideGlass: Range[];
  doorHandles: number[];
  lampY: Range;
  grilleX: number;
  lampX: Range;
  tailY: Range;
  /** Inner edge of the tail lights. */
  tailX: number;
  bumperY: Range;
  rearBumperDepth: number;
  /** Box-flared wheel arches: how far (m) they stick out from the side. */
  flare?: number;
  /** Four round headlights in a black panel instead of rectangular lamps: [x, radius] per lamp and side. */
  roundLamps?: [number, number][];
  /** Hood vents, painted bumpers and a spoiler on the roof or boot lid. */
  hoodVents?: boolean;
  paintedBumpers?: boolean;
  spoiler?: 'roof' | 'trunk';
  /** Intercooler air intake on the hood, between the windscreen and the start number. */
  hoodScoop?: boolean;
  /** Narrow lamps in a black band across the front, instead of a grille with a chrome surround. */
  lampBand?: boolean;
  /** Body corner radius; larger gives a rounder car. */
  round?: number;
  /** x (centre) of the auxiliary lights on the class 2 light pod, if they shouldn't be spread wide across the front. */
  podX?: number[];
  /** Bumper height (default 0.2 m). */
  bumperH?: number;
  /** Indicators out in the corners of the front bumper instead of in the headlights. */
  bumperBlinkers?: boolean;
  /** Painted bumpers: air intake only at the front, not also at the rear. */
  frontIntakeOnly?: boolean;
  /** How much the belt line rises from the windscreen base to the rear edge (wedge shape). */
  beltRise?: number;
  /** How much narrower the nose and tail get seen from above, as a fraction of the width. */
  taper?: Range;
  /** Painted mirrors and an air intake at the front of the roof. */
  paintedMirrors?: boolean;
  roofVent?: boolean;
  /** White rims with a tight ring of holes, like rally rims, instead of hubcaps. */
  rallyRims?: boolean;
  /** A raised air intake on the hood covers z from, to; the start number and sponsors are drawn outside it. */
  hoodScoopZ?: Range;
}

