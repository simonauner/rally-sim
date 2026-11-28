/**
 * Stage lengths from start to finish (m), precomputed so the menus don't have to build every stage.
 * The physics test compares them with the built stage and prints the correct value if a road changed.
 */
export const STAGE_LENGTHS: Record<string, number> = {
  'Grinsbol': 4492,
  'Tollesrud': 4552,
  'Åsterud': 4534,
  'Botten': 5847,
  'Rannsjön': 5912,
  'Larssäter': 4340,
  'Stor-Jangen': 4312,
  'Åsjön': 5175,
  'Altarliden': 5172,
  'Bergtjärnen': 5158,
  'Torpet': 5086,
  'Trollberget': 5070,
  'Näs': 3268,
  'Rickleån': 3243,
  'Valsfäboda': 3221,
  'Storberget': 4953,
  'Hösjöälven': 5161,
  'Röjmyrberget': 5222,
  'Flarkån': 5184,
  'Södra Hulteby': 4802,
  'Ämten': 4842,
  'Lindås': 4811,
  'Lungsund': 4764,
  'Sundstorp': 5663,
  'Bäckelid': 5621,
  'Niklasdamm': 4248,
  'Broby': 4335,
};
