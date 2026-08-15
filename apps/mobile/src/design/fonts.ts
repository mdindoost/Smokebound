/**
 * The bundled serif (DESIGN.md V3).
 *
 * EB Garamond ships with the app rather than borrowing a platform face, so a
 * screenshot taken on an iPhone and one taken on a Pixel are the same image.
 * Marketing is a design requirement (SPEC §6) and platform-dependent type
 * undermines it.
 *
 * Loading is non-blocking: if the face has not arrived yet the app renders in
 * the platform serif and swaps when it does. An app about waiting should not
 * make you wait for a font.
 */

import { useFonts } from 'expo-font';

export const SERIF_REGULAR = 'EBGaramond_400Regular';
export const SERIF_SEMIBOLD = 'EBGaramond_600SemiBold';

/**
 * The faces are **subset** copies in `assets/fonts/`, not the package's own
 * (see `scripts/subset-fonts.mjs`): 959 KB of EB Garamond becomes 346 KB by
 * dropping Greek, Cyrillic and the alternates this app cannot draw.
 *
 * Nothing is lost that worked before. MECHANICS §5 makes any script a legal
 * message, and that already leans on system fallback for everything EB
 * Garamond lacks — no Devanagari, no Arabic, no CJK, no emoji. Dropping Greek
 * and Cyrillic moves two more scripts into the same fallback every other
 * non-Latin script already uses.
 *
 * The subsets are committed rather than generated at build time, because a step
 * that must run before the app can render text is a step that will one day not
 * run.
 */
export function useAppFonts(): boolean {
  const [loaded] = useFonts({
    EBGaramond_400Regular: require('../../assets/fonts/EBGaramond_400Regular.ttf'),
    EBGaramond_600SemiBold: require('../../assets/fonts/EBGaramond_600SemiBold.ttf'),
  });
  return loaded;
}
