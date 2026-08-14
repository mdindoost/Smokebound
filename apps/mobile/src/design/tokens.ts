/**
 * The visual language: parchment, ember, and sky (SPEC §2).
 *
 * Three families and nothing else. Parchment is the ground the app is written
 * on, ember is the fire and the only thing that ever shouts, sky is distance,
 * weather and time. Everything M5 draws on the map has to sit inside this
 * palette, so it is defined once, here, in semantic terms — screens never write
 * a hex value.
 *
 * **Cultural design rule (SPEC §2, REDTEAM F7), binding on every token below:**
 * the identity draws on the worldwide history of signal fire — Chinese beacon
 * towers, Polybius' torches, Aboriginal and Native American practice — through
 * material and light, never through iconography of a people. Parchment, ash,
 * ember, distance. No feathers, no teepees, no faux-"Indian" naming, ever.
 */

export const palette = {
  // Parchment — the ground.
  parchment: '#F5EADA',
  parchmentRaised: '#FBF4E9',
  parchmentSunk: '#EADCC6',
  parchmentEdge: '#DCC9AC',

  // Ink — what is written on it.
  ink: '#2B211A',
  inkSoft: '#5A4B3E',
  inkFaint: '#8C7A69',

  // Ember — fire. Used sparingly: this is the only colour that raises its voice.
  ember: '#C2521C',
  emberBright: '#E2802F',
  emberGlow: '#F6C88A',
  emberDim: '#8E3A12',

  // Sky — distance, weather, time.
  sky: '#4E7593',
  skyPale: '#B7CBDC',
  skyDeep: '#2F4657',
  storm: '#5D6873',

  // States. Muted on purpose — a lost message is elegiac, not an error dialog.
  ash: '#7C7269',
  moss: '#5E7A54',
} as const;

/** Semantic colours. Screens use these, never `palette` directly. */
export const colors = {
  background: palette.parchment,
  surface: palette.parchmentRaised,
  surfaceSunk: palette.parchmentSunk,
  border: palette.parchmentEdge,

  text: palette.ink,
  textSoft: palette.inkSoft,
  textFaint: palette.inkFaint,

  accent: palette.ember,
  accentBright: palette.emberBright,
  accentSoft: palette.emberGlow,
  onAccent: '#FFF6EA',

  distance: palette.sky,
  distanceSoft: palette.skyPale,
  weather: palette.storm,

  /** Message states (ARCHITECTURE §4). */
  transmitting: palette.emberBright,
  inFlight: palette.sky,
  stranded: palette.storm,
  delivered: palette.moss,
  lost: palette.ash,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radii = {
  sm: 6,
  md: 10,
  lg: 16,
  pill: 999,
} as const;

/**
 * Two faces: a serif for anything that wants to feel written down (titles, the
 * Ledger, the Keeper's lines) and the system sans for interface furniture. The
 * mono face carries flight data — distances, ETAs, cell ids.
 */
export const fonts = {
  serif: {
    ios: 'Iowan Old Style',
    android: 'serif',
    default: 'serif',
  },
  sans: {
    ios: 'System',
    android: 'sans-serif',
    default: 'System',
  },
  mono: {
    ios: 'Menlo',
    android: 'monospace',
    default: 'monospace',
  },
} as const;

export const type = {
  display: { size: 30, lineHeight: 36, weight: '600' as const },
  title: { size: 22, lineHeight: 28, weight: '600' as const },
  heading: { size: 17, lineHeight: 22, weight: '600' as const },
  body: { size: 16, lineHeight: 23, weight: '400' as const },
  small: { size: 14, lineHeight: 19, weight: '400' as const },
  caption: { size: 12, lineHeight: 16, weight: '500' as const },
} as const;

/** Soft, warm, low — parchment does not float. */
export const elevation = {
  card: {
    shadowColor: palette.ink,
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
} as const;

export type MessageStateColorKey =
  | 'transmitting'
  | 'inFlight'
  | 'stranded'
  | 'delivered'
  | 'lost';

export const stateColor = (state: string): string => {
  switch (state) {
    case 'TRANSMITTING':
      return colors.transmitting;
    case 'IN_FLIGHT':
      return colors.inFlight;
    case 'STRANDED':
      return colors.stranded;
    case 'DELIVERED':
      return colors.delivered;
    case 'LOST':
      return colors.lost;
    default:
      return colors.textFaint;
  }
};
