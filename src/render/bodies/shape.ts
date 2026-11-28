/**
 * Body dimensions, one per car in this folder, matching the car's Blender model. They place the decals,
 * the dent zones and the tail-light glow; the body itself is the model.
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
  /** Base and top (z) of the windscreen and rear window. */
  screen: Range;
  backlight: Range;
  cabinHalfX: number;
  /** Wheel arch centre (y) and radius, front and rear. */
  archY: number;
  archR: Range;
  /** Door seams behind the windscreen base (z). */
  doorSeams: number[];
  tailY: Range;
  /** Inner edge of the tail lights. */
  tailX: number;
  bumperY: Range;
  /** A raised air intake on the hood covers z from, to; the start number and sponsors are drawn outside it. */
  hoodScoopZ?: Range;
}

