/**
 * Phone sign-in (SPEC §3: phone/Apple auth).
 *
 * Apple sign-in needs an entitlement and a paid account; it is wired in M6 with
 * the rest of the store work. Phone is what the beta runs on.
 */

import { router } from 'expo-router';
import { useState } from 'react';

import { Body, Button, Card, Display, Field, Screen, Small } from '../src/design/components';
import { useSession } from '../src/lib/session';

export default function SignIn() {
  const { gateway, refresh } = useSession();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestCode = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await gateway.signInWithPhone(phone.trim());
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const verify = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await gateway.verifyPhoneOtp(phone.trim(), code.trim());
      await refresh();
      router.replace('/');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Display tone="accent">SMOKE</Display>
      <Body tone="soft">
        A messenger that delivers by smoke signal. Slower than pigeons. The weather is real.
      </Body>

      <Card>
        {!sent ? (
          <>
            <Field
              label="Phone number"
              placeholder="+1 555 010 1234"
              autoComplete="tel"
              keyboardType="phone-pad"
              value={phone}
              onChangeText={setPhone}
              error={error}
            />
            <Button
              label="Send me a code"
              onPress={() => void requestCode()}
              loading={busy}
              disabled={phone.trim().length < 8}
            />
          </>
        ) : (
          <>
            <Field
              label="Code"
              placeholder="123456"
              keyboardType="number-pad"
              autoComplete="sms-otp"
              value={code}
              onChangeText={setCode}
              error={error}
              hint={`Sent to ${phone.trim()}`}
            />
            <Button
              label="Light the fire"
              onPress={() => void verify()}
              loading={busy}
              disabled={code.trim().length < 4}
            />
            <Button label="Use a different number" variant="ghost" onPress={() => setSent(false)} />
          </>
        )}
      </Card>

      <Small tone="faint">
        We store your number for sign-in only, and a city-scale location so your smoke has
        somewhere to travel. Nothing else.
      </Small>
    </Screen>
  );
}
