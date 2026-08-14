/**
 * Placeholder route.
 *
 * Expo Router needs at least one route to boot, so this exists purely to make
 * `npm start -w apps/mobile` run. It is not a product screen and carries no
 * design intent — the Sky home screen is M5 (ARCHITECTURE §7, §10).
 */

import { Text, View } from 'react-native';

export default function Placeholder() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text>SMOKE — M1 scaffold. No screens yet.</Text>
    </View>
  );
}
