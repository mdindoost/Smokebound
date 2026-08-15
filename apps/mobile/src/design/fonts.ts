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

import { EBGaramond_400Regular, EBGaramond_600SemiBold, useFonts } from '@expo-google-fonts/eb-garamond';

export const SERIF_REGULAR = 'EBGaramond_400Regular';
export const SERIF_SEMIBOLD = 'EBGaramond_600SemiBold';

export function useAppFonts(): boolean {
  const [loaded] = useFonts({ EBGaramond_400Regular, EBGaramond_600SemiBold });
  return loaded;
}
