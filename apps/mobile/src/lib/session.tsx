/**
 * Session state: who is signed in, and whether they have finished lighting
 * their first fire (a handle and a home cell).
 *
 * The gateway is injected rather than imported so the app can be driven by a
 * test double — the same seam the two-client end-to-end test uses.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import type { DataGateway, ProfileView, SessionUser } from './gateway';

export type OnboardingStage = 'loading' | 'signed-out' | 'needs-profile' | 'ready';

interface SessionState {
  gateway: DataGateway;
  user: SessionUser | null;
  profile: ProfileView | null;
  stage: OnboardingStage;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({
  gateway,
  children,
}: {
  gateway: DataGateway;
  children: ReactNode;
}) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [profile, setProfile] = useState<ProfileView | null>(null);
  const [stage, setStage] = useState<OnboardingStage>('loading');

  const refresh = useCallback(async () => {
    const current = await gateway.currentUser();
    setUser(current);
    if (!current) {
      setProfile(null);
      setStage('signed-out');
      return;
    }
    const mine = await gateway.myProfile();
    setProfile(mine);
    setStage(mine ? 'ready' : 'needs-profile');
  }, [gateway]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signOut = useCallback(async () => {
    await gateway.signOut();
    await refresh();
  }, [gateway, refresh]);

  const value = useMemo<SessionState>(
    () => ({ gateway, user, profile, stage, refresh, signOut }),
    [gateway, user, profile, stage, refresh, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside a SessionProvider');
  return value;
}

export function useGateway(): DataGateway {
  return useSession().gateway;
}
