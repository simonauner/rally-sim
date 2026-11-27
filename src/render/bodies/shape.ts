/**
 * Karossens form, en per bil i den här mappen. Varje bil har sin egen fil, så en ändring av en bils
 * form aldrig påverkar en annan. Nya detaljer i den delade koden i carMesh.ts slås på med ett fält här,
 * så att bilar som inte sätter fältet ser ut som förut.
 */

export type Range = readonly [number, number];

/** Karossens form i bilens koordinater (fram = +z, origo i tyngdpunkten). */
export interface BodyShape {
  halfX: number;
  bottom: number;
  /** Plåtens framkant och bakkant. */
  nose: number;
  tail: number;
  /** Gördellinjen, rak från huv till baklucka. */
  belt: number;
  roof: number;
  /** Sidolistens höjd. */
  crease: number;
  /** Vindrutans och bakrutans fot och topp (z). */
  screen: Range;
  backlight: Range;
  /** Hur mycket huven sluttar ner mot fronten och bakluckan mot bakkanten. */
  hoodDrop: number;
  trunkDrop: number;
  cabinHalfX: number;
  /** Hjulhusens centrum (y) och radie fram och bak. */
  archY: number;
  archR: Range;
  /** Dörrspringor bakom vindrutans fot (z). */
  doorSeams: number[];
  /** Sidorutor (z från, till). ±Infinity följer A- respektive C-stolpen. */
  sideGlass: Range[];
  doorHandles: number[];
  lampY: Range;
  grilleX: number;
  lampX: Range;
  tailY: Range;
  /** Baklyktornas innerkant. */
  tailX: number;
  bumperY: Range;
  rearBumperDepth: number;
  /** Lådformade utbyggda hjulhus: hur långt (m) de sticker ut från sidan. */
  flare?: number;
  /** Fyra runda strålkastare i en svart panel i stället för rektangulära lyktor: [x, radie] per lykta och sida. */
  roundLamps?: [number, number][];
  /** Ventiler i motorhuven, lackade stötfångare och spoiler på taket eller bakluckan. */
  hoodVents?: boolean;
  paintedBumpers?: boolean;
  spoiler?: 'roof' | 'trunk';
  /** Luftintag för laddluftkylaren på huven, mellan vindrutan och startnumret. */
  hoodScoop?: boolean;
  /** Smala lyktor i ett svart band tvärs över fronten, i stället för grill med kromram. */
  lampBand?: boolean;
  /** Karossens hörnradie; större ger en rundare bil. */
  round?: number;
  /** Extraljusens x (mitt) på klass 2-rampen, om de inte ska spridas brett över fronten. */
  podX?: number[];
  /** Stötfångarnas höjd (standard 0,2 m). */
  bumperH?: number;
  /** Blinkers ute i hörnen på den främre stötfångaren i stället för i strålkastarna. */
  bumperBlinkers?: boolean;
  /** Lackade stötfångare: luftintaget bara fram, inte även bak. */
  frontIntakeOnly?: boolean;
  /** Hur mycket gördellinjen stiger från vindrutans fot till bakkanten (kilform). */
  beltRise?: number;
  /** Hur mycket smalare nosen och bakpartiet blir sett ovanifrån, som andel av bredden. */
  taper?: Range;
  /** Lackade backspeglar och ett luftintag framtill på taket. */
  paintedMirrors?: boolean;
  roofVent?: boolean;
  /** Vita fälgar med en tät ring av hål, som rallyfälgar, i stället för navkapslar. */
  rallyRims?: boolean;
  /** Ett upphöjt luftintag på huven täcker z från, till; startnumret och sponsorerna ritas utanför. */
  hoodScoopZ?: Range;
}

