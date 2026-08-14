/**
 * Claim a handle. Shape-checked here, uniqueness decided by the database.
 */

import { router } from 'expo-router';
import { useState } from 'react';

import { Body, Button, Card, Field, Screen, Small, Title } from '../../src/design/components.js';
import { HANDLE_MAX, validateHandle } from '../../src/lib/handle.js';

export default function ClaimHandle() {
  const [handle, setHandle] = useState('');
  const [displayName, setDisplayName] = useState('');

  const check = validateHandle(handle);
  const problem = handle.length > 0 && !check.ok ? check.message : null;

  return (
    <Screen>
      <Title>What should your smoke be signed?</Title>
      <Body tone="soft">
        Your handle is how your flock finds you. It is public to people you have added, and to
        nobody else.
      </Body>

      <Card>
        <Field
          label="Handle"
          placeholder="riverbend"
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={HANDLE_MAX}
          value={handle}
          onChangeText={setHandle}
          error={problem}
          hint="3–20 characters. Letters, numbers and underscores."
        />
        <Field
          label="Display name (optional)"
          placeholder="Sam"
          value={displayName}
          onChangeText={setDisplayName}
        />
        <Button
          label="Next: your fire"
          disabled={!check.ok}
          onPress={() =>
            router.push({
              pathname: '/onboarding/fire',
              params: { handle: handle.trim(), displayName: displayName.trim() },
            })
          }
        />
      </Card>

      <Small tone="faint">You can change your display name later. The handle is yours for good.</Small>
    </Screen>
  );
}
